import { describe, expect, it, vi } from 'vitest'
import { defineModel } from '../../../src/meta/map-schema'
import { knn } from '../../../src/services/query/knn.service'
import { clearFilterParams, setFilterParams } from '../../../src/services/query/filters'
import type { GraphNode, QueryOutput, QueryRecord, Runner } from '../../../src/driver/types'

/**
 * kNN hydration (NTS-447): knn() hydrates the matched nodes into model
 * instances and pairs each with its similarity score, mirroring search().
 * The runner is mocked — no database involved.
 */

// ---- Fixtures (per-file: decorator registry is global per module registry) --

const Doc = defineModel('KnnUnitDoc', {
  title: 'string',
  emb: 'float',
})

interface HydratedDoc {
  _id: string
  title?: string
  emb?: number[]
}

const node = (properties: Record<string, unknown>): GraphNode => ({
  elementId: '4:unit-1',
  labels: ['KnnUnitDoc'],
  properties,
})

const record = (values: Record<string, unknown>): QueryRecord => ({
  get: (key) => values[key],
  has: (key) => Object.hasOwn(values, key),
  keys: Object.keys(values),
})

const output = (rows: Record<string, unknown>[]): QueryOutput => ({
  records: rows.map(record),
})

const scoredRows = (): Record<string, unknown>[] => [
  { node: node({ title: 'Near', emb: [0.9, 0.1, 0] }), score: 0.95 },
  { node: node({ title: 'Far', emb: [0, 1, 0] }), score: 0.5 },
]

const runner = (run: (statement: string) => Promise<QueryOutput>): Runner => ({ run })

// ---------------------------------------------------------------------------

describe('knn hydration (NTS-447)', () => {
  it('returns hydrated model instances with their scores, best first', async () => {
    const run = vi.fn(runner(() => Promise.resolve(output(scoredRows()))).run)

    const results = await knn<HydratedDoc>(
      { run },
      Doc,
      'doc_emb_vector',
      [1, 0.1, 0],
      2,
      'procedure',
    )

    expect(results).toHaveLength(2)
    expect(results[0].entity).toBeInstanceOf(Doc)
    expect(results[0].entity.title).toBe('Near')
    expect(results[0].entity.emb).toEqual([0.9, 0.1, 0])
    expect(results[0].score).toBe(0.95)
    expect(results[1].entity.title).toBe('Far')
    expect(results[1].score).toBe(0.5)
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)

    const [statement, parameters] = run.mock.calls[0]
    expect(statement).toBe(
      'CALL db.index.vector.queryNodes($index, $k, $vector) ' +
        'YIELD node, score RETURN node, score ORDER BY score DESC',
    )
    expect(parameters).toEqual({ index: 'doc_emb_vector', k: 2, vector: [1, 0.1, 0] })
  })

  it('inlines the index name in the SEARCH clause form', async () => {
    const run = vi.fn(runner(() => Promise.resolve(output(scoredRows()))).run)

    await knn<HydratedDoc>({ run }, Doc, 'doc_emb_vector', [1, 0.1, 0], 2, 'search-clause')

    expect(run.mock.calls[0][0]).toBe(
      'MATCH (n:`KnnUnitDoc`) ' +
        'SEARCH n IN (VECTOR INDEX `doc_emb_vector` FOR $vector LIMIT $k) ' +
        'SCORE AS score RETURN n AS node, score ORDER BY score DESC',
    )
  })

  it('auto mode degrades from the SEARCH clause to the procedure', async () => {
    const run = vi.fn(async (statement: string): Promise<QueryOutput> => {
      if (statement.includes('SEARCH')) {
        throw new Error('SEARCH clause unsupported')
      }

      return output(scoredRows())
    })

    const results = await knn<HydratedDoc>({ run }, Doc, 'doc_emb_vector', [1, 0.1, 0], 2)

    expect(results).toHaveLength(2)
    expect(results[0].entity.title).toBe('Near')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('reports both errors when neither query form is supported', async () => {
    const run = vi.fn(runner(() => Promise.reject(new Error('offline'))).run)

    await expect(knn<HydratedDoc>({ run }, Doc, 'doc_emb_vector', [1, 0.1, 0], 2)).rejects.toThrow(
      'neither the Cypher 25 SEARCH clause (offline) nor the db.index.vector.queryNodes procedure (offline)',
    )
  })

  it('skips rows without a node under the alias', async () => {
    const rows = [
      ...scoredRows(),
      // OPTIONAL MATCH miss and a null column must not produce entities
      { score: 0.9 },
      { node: null, score: 0.4 },
    ]
    const run = runner(() => Promise.resolve(output(rows))).run

    const results = await knn<HydratedDoc>(
      { run },
      Doc,
      'doc_emb_vector',
      [1, 0.1, 0],
      4,
      'procedure',
    )

    expect(results).toHaveLength(2)
  })

  it('validates its arguments before touching the runner', async () => {
    const run = vi.fn(runner(() => Promise.resolve(output([]))).run)

    await expect(knn({ run }, Doc, '', [1, 0, 0], 1)).rejects.toThrow(TypeError)
    await expect(knn({ run }, Doc, 'doc_emb_vector', [], 1)).rejects.toThrow(TypeError)
    await expect(knn({ run }, Doc, 'doc_emb_vector', [1, 'x' as never], 1)).rejects.toThrow(
      TypeError,
    )
    await expect(knn({ run }, Doc, 'doc_emb_vector', [1, 0, 0], 0)).rejects.toThrow(TypeError)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('kNN filtered reads over-fetch to fill k (NTS-584)', () => {
  // Soft delete renders as a label predicate (NOT node:Deleted) and the
  // tenant filter as a parameterised property predicate — the two shapes
  // the filters take
  const FilteredDoc = defineModel('KnnUnitFilteredDoc', {
    title: 'string',
    emb: 'float',
    filters: [
      { name: 'tenant', where: 'node.tenant = $tenant' },
      { name: 'notDeleted', where: 'NOT node:Deleted' },
    ],
  })

  beforeEach(() => {
    setFilterParams('tenant', 'acme')
  })

  afterEach(() => {
    clearFilterParams()
  })

  const filteredNode = (title: string, score: number): Record<string, unknown> => ({
    node: node({ title }),
    score,
  })

  it('over-fetches round over round until k rows survive the filters', async () => {
    let calls = 0
    const run = vi.fn(async (): Promise<QueryOutput> => {
      calls += 1

      // Round 1 (fetch k=2): one survivor; round 2 (fetch 4): enough
      return output(
        calls === 1
          ? [filteredNode('Survivor', 0.9)]
          : [
              filteredNode('Survivor', 0.9),
              filteredNode('Live 2', 0.8),
              filteredNode('Live 3', 0.7),
            ],
      )
    })

    const results = await knn<HydratedDoc>(
      { run },
      FilteredDoc,
      'doc_emb_vector',
      [1, 0.1, 0],
      2,
      'procedure',
    )

    // The over-fetched round is sliced back to k, best first
    expect(results).toHaveLength(2)
    expect(results[0].entity).toBeInstanceOf(FilteredDoc)
    expect(results[0].entity.title).toBe('Survivor')
    expect(results[1].entity.title).toBe('Live 2')

    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[0][0]).toBe(
      'CALL db.index.vector.queryNodes($index, $k, $vector) ' +
        'YIELD node, score WHERE (node.tenant = $tenant) AND (NOT node:Deleted) ' +
        'RETURN node, score ORDER BY score DESC',
    )
    expect(run.mock.calls[0][1]).toEqual({
      index: 'doc_emb_vector',
      k: 2,
      vector: [1, 0.1, 0],
      tenant: 'acme',
    })
    expect(run.mock.calls[1][1]).toEqual({
      index: 'doc_emb_vector',
      k: 4,
      vector: [1, 0.1, 0],
      tenant: 'acme',
    })
  })

  it('the SEARCH clause form takes the filters before the RETURN', async () => {
    // Two rows for fetch k=2 — a single round, the statement is the point
    const run = vi.fn(
      runner(() =>
        Promise.resolve(output([filteredNode('Survivor', 0.9), filteredNode('Live 2', 0.8)])),
      ).run,
    )

    await knn<HydratedDoc>({ run }, FilteredDoc, 'doc_emb_vector', [1, 0.1, 0], 2, 'search-clause')

    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toBe(
      'MATCH (n:`KnnUnitFilteredDoc`) ' +
        'SEARCH n IN (VECTOR INDEX `doc_emb_vector` FOR $vector LIMIT $k) ' +
        'SCORE AS score WHERE (n.tenant = $tenant) AND (NOT n:Deleted) ' +
        'RETURN n AS node, score ORDER BY score DESC',
    )
  })

  it('gives up at the round cap and returns the widest round', async () => {
    // Every round filters down to one row — k stays a ceiling here
    const run = vi.fn(runner(() => Promise.resolve(output([filteredNode('Only', 0.9)]))).run)

    const results = await knn<HydratedDoc>(
      { run },
      FilteredDoc,
      'doc_emb_vector',
      [1, 0.1, 0],
      2,
      'procedure',
    )

    expect(results).toHaveLength(1)
    expect(results[0].entity.title).toBe('Only')
    expect(run).toHaveBeenCalledTimes(3)
    expect(run.mock.calls.map((call) => call[1]?.k)).toEqual([2, 4, 8])
  })
})
