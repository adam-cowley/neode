// support/backend first: it initialises neode.service, breaking the
// utils <-> neode.service circular init that would otherwise surface
// when this file's service imports are evaluated first.
import { openBackend, TestBackend } from './support/backend'
import { knn } from '../../src/services/query/knn.service'
import { VectorIndexService, vectorIndexName } from '../../src/services/schema/vector.service'
import { NodeEntity, InternalId, Float, Filter, Property, SoftDelete, Vector } from '../../src/decorators'
import { clearFilterParams, setFilterParams } from '../../src/index'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Doc {
  @InternalId()
  _id: string

  @Float({ array: true })
  @Vector({ dimensions: 3 })
  emb: number[]
}

// Soft delete (label state) + tenant (parameterised) on the same model —
// the two filter shapes the kNN reads must honour (NTS-584)
@NodeEntity()
@SoftDelete()
@Filter({ name: 'tenant', where: 'node.tenant = $tenant' })
class FilteredDoc {
  @InternalId()
  _id: string

  @Property({ type: 'string' })
  id: string

  @Property({ type: 'string' })
  tenant: string

  @Float({ array: true })
  @Vector({ dimensions: 3 })
  emb: number[]
}

// ---------------------------------------------------------------------------

const INDEX = 'doc_emb_vector_d9d13582'
const FILTERED_INDEX = vectorIndexName({ label: 'FilteredDoc', property: 'emb', dimensions: 3 })

describe('vector kNN search', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()

    if (backend.capabilities.vector) {
      const results = await new VectorIndexService(backend.connection, [
        { label: 'Doc', property: 'emb', dimensions: 3 },
        { label: 'FilteredDoc', property: 'emb', dimensions: 3 },
      ]).create()

      expect(results.every((result) => result.success)).toBe(true)
    }
  })

  beforeEach(async () => {
    await backend.clearGraph()
    clearFilterParams()
    setFilterParams('tenant', 'acme')

    // Near, Far, and the nearest neighbour of the query vector
    await backend.connection.run('CREATE (:Doc {emb: [1.0, 0.0, 0.0]})')
    await backend.connection.run('CREATE (:Doc {emb: [0.0, 1.0, 0.0]})')
    await backend.connection.run('CREATE (:Doc {emb: [0.9, 0.1, 0.0]})')

    // The two nearest neighbours of the query vector [1, 0, 0] are both
    // filtered out — the closest is soft-deleted, the second another
    // tenant's. Filtering after the index's top-k (the pre-NTS-584
    // behaviour) turned k=2 into zero rows.
    await backend.connection.run(`
      CREATE (:FilteredDoc:Deleted {id: 'dead', tenant: 'acme', emb: [1.0, 0.0, 0.0]})
      CREATE (:FilteredDoc {id: 'other', tenant: 'globex', emb: [0.99, 0.01, 0.0]})
      CREATE (:FilteredDoc {id: 'live-1', tenant: 'acme', emb: [0.9, 0.1, 0.0]})
      CREATE (:FilteredDoc {id: 'live-2', tenant: 'acme', emb: [0.8, 0.2, 0.0]})
    `)
  })

  afterEach(async () => {
    clearFilterParams()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('returns the nearest neighbours hydrated with scores, best first', async () => {
    if (!backend.capabilities.vector) {
      return
    }

    const results = await knn<Doc>(backend.connection, Doc, INDEX, [1, 0.1, 0], 2)

    expect(results).toHaveLength(2)
    expect(results[0].entity).toBeInstanceOf(Doc)
    expect(results[0].entity.emb).toEqual([0.9, 0.1, 0])
    expect(results[1].entity.emb).toEqual([1, 0, 0])
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)
  })

  it('works through both query forms explicitly', async () => {
    if (!backend.capabilities.vector) {
      return
    }

    for (const mode of ['procedure', 'search-clause'] as const) {
      try {
        const results = await knn<Doc>(backend.connection, Doc, INDEX, [1, 0.1, 0], 1, mode)

        expect(results).toHaveLength(1)
        expect(results[0].entity.emb).toEqual([0.9, 0.1, 0])
      } catch (error) {
        // Pre-Cypher-25 servers (Neo4j 5.x) have no SEARCH clause — the
        // explicit form correctly rejects there; auto mode's fallback
        // (previous test) covers those backends
        if (mode === 'procedure') {
          throw error
        }

        expect(String(error)).toContain('SEARCH')
      }
    }
  })

  it('auto-degrades from the SEARCH clause to the procedure', async () => {
    if (!backend.capabilities.vector) {
      return
    }

    const results = await knn<Doc>(backend.connection, Doc, INDEX, [1, 0.1, 0], 1)

    expect(results).toHaveLength(1)
  })

  it('validates its arguments before touching the database', async () => {
    await expect(knn(backend.connection, Doc, INDEX, [1, 0, 0], 0)).rejects.toThrow(TypeError)
    await expect(knn(backend.connection, Doc, INDEX, [], 1)).rejects.toThrow(TypeError)
    await expect(knn(backend.connection, Doc, INDEX, [1, 'x' as never], 1)).rejects.toThrow(
      TypeError,
    )
    await expect(knn(backend.connection, Doc, '', [1, 0, 0], 1)).rejects.toThrow(TypeError)
  })

  describe('read filters fill k by over-fetching (NTS-584)', () => {
    const ids = (results: { entity: FilteredDoc }[]): string[] =>
      results.map((result) => result.entity.id)

    it('fills k past soft-deleted and other-tenant neighbours', async () => {
      if (!backend.capabilities.vector) {
        return
      }

      const results = await knn<FilteredDoc>(
        backend.connection,
        FilteredDoc,
        FILTERED_INDEX,
        [1, 0, 0],
        2,
      )

      expect(ids(results)).toEqual(['live-1', 'live-2'])
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)
    })

    it('fills k through the procedure form explicitly', async () => {
      if (!backend.capabilities.vector) {
        return
      }

      // k=1: the top neighbour is soft-deleted — the over-fetch loop
      // walks k=1, 2, 4 before a live row survives
      const results = await knn<FilteredDoc>(
        backend.connection,
        FilteredDoc,
        FILTERED_INDEX,
        [1, 0, 0],
        1,
        'procedure',
      )

      expect(ids(results)).toEqual(['live-1'])
    })

    it('k beyond the valid rows returns every valid neighbour (ceiling)', async () => {
      if (!backend.capabilities.vector) {
        return
      }

      const results = await knn<FilteredDoc>(
        backend.connection,
        FilteredDoc,
        FILTERED_INDEX,
        [1, 0, 0],
        10,
      )

      expect(ids(results)).toEqual(['live-1', 'live-2'])
    })

    it('withoutFilters keeps k as the ceiling over the raw top-k', async () => {
      if (!backend.capabilities.vector) {
        return
      }

      const results = await knn<FilteredDoc>(
        backend.connection,
        FilteredDoc,
        FILTERED_INDEX,
        [1, 0, 0],
        2,
        'auto',
        { withoutFilters: ['softDelete', 'tenant'] },
      )

      expect(ids(results)).toEqual(['dead', 'other'])
    })
  })

  it('drops the index following the schema service result pattern', async () => {
    const results = await new VectorIndexService(backend.connection, [
      { label: 'Doc', property: 'emb', dimensions: 3 },
    ]).drop()

    expect(results).toHaveLength(1)
    expect(results[0].action).toBe('DROP')
    expect(results[0].statement).toBe('DROP VECTOR INDEX doc_emb_vector_d9d13582 IF EXISTS')
    // success is not asserted: dropping vector indexes is not supported
    // on every backend (e.g. Relate), which the result pattern reports
    // per statement instead of throwing
  })

  it('Repository#knn derives the index name from the model declaration', async () => {
    if (!backend.capabilities.vector) {
      return
    }

    const repository = backend.neode.getRepository(Doc)
    const results = await repository.knn('emb', [1, 0.1, 0], 2)

    expect(results).toHaveLength(2)
    expect(results[0].entity).toBeInstanceOf(Doc)
    expect(results[0].entity.emb).toEqual([0.9, 0.1, 0])
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)
  })

  it('Repository#knn applies the model named read filters', async () => {
    if (!backend.capabilities.vector) {
      return
    }

    const repository = backend.neode.getRepository(FilteredDoc)
    const results = await repository.knn('emb', [1, 0, 0], 2)

    // the two nearest neighbours are filtered out (soft-deleted, other
    // tenant) — the same NTS-584 over-fetch the service-level knn does
    expect(results.map((result) => result.entity.id)).toEqual(['live-1', 'live-2'])
  })

  it('Repository#knn rejects a property that is not declared @Vector', async () => {
    const repository = backend.neode.getRepository(FilteredDoc)

    await expect(repository.knn('tenant', [1, 0, 0], 2)).rejects.toThrow(
      /not declared with @Vector/,
    )
  })

  it('Repository#knn rejects an unknown property', async () => {
    const repository = backend.neode.getRepository(Doc)

    await expect(repository.knn('nope', [1, 0, 0], 2)).rejects.toThrow(/no property named/)
  })
})
