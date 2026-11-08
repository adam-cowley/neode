import { describe, expect, it, vi } from 'vitest'
import { NodeEntity, Property } from '../../src/decorators'
import { getModel } from '../../src/meta'
import { defineModel } from '../../src/meta/map-schema'
import { NeodeError } from '../../src/errors'
import { hydrate } from '../../src/hydrate'
import { CreateService } from '../../src/services/query/create.service'
import { MergeService } from '../../src/services/query/merge.service'
import { UpdateService } from '../../src/services/query/update.service'
import type { EntitySchema } from '../../src/meta/entity/entity-schema'
import type { GraphNode, QueryOutput, QueryRecord, Runner } from '../../src/driver/types'

/**
 * Embedding transforms + the vector write path (NTS-449, portable SET form NTS-507).
 * The runner is mocked — no database involved (knn.test.ts pattern).
 */

// ---- Fixtures (per-file: decorator registry is global per module registry) --

const TransformDoc = defineModel('Nts449TransformDoc', {
  role: {
    type: 'string',
    // Raw 'admin' fails the valid rule; the in-transform makes it pass —
    // proof the transform runs before validation
    valid: ['ADMIN'],
    transform: { in: (value: unknown) => String(value).toUpperCase() },
  },
})

const AsyncDoc = defineModel('Nts449AsyncDoc', {
  name: {
    type: 'string',
    transform: { in: (value: unknown) => Promise.resolve(`async:${String(value)}`) },
  },
})

const OutDoc = defineModel('Nts449OutDoc', {
  data: {
    type: 'any',
    transform: { in: JSON.stringify, out: JSON.parse as (value: unknown) => unknown },
  },
})

const OutFailDoc = defineModel('Nts449OutFailDoc', {
  name: {
    type: 'string',
    transform: {
      out: () => {
        throw new Error('boom')
      },
    },
  },
})

const OutAsyncDoc = defineModel('Nts449OutAsyncDoc', {
  name: { type: 'string', transform: { out: (value: unknown) => Promise.resolve(value) } },
})

@NodeEntity()
class VectorMovie {
  @Property({ type: 'string' })
  title!: string

  @Property({ type: 'any', vector: { dimensions: 3 } })
  emb!: number[]
}

/** A model whose `emb` vector embeds the `plot` property with the given provider */
function defineEmbedDoc(provider: (text: string) => Promise<number[]>, name: string) {
  return {
    model: defineModel(name, {
      plot: 'string',
      emb: { type: 'any', vector: { dimensions: 3, from: 'plot', provider } },
    }),
  }
}

// ---- Runner mock ------------------------------------------------------------

const record = (values: Record<string, unknown>): QueryRecord => ({
  get: (key) => values[key],
  has: (key) => Object.hasOwn(values, key),
  keys: Object.keys(values),
})

const output = (rows: Record<string, unknown>[]): QueryOutput => ({
  records: rows.map(record),
})

const node = (properties: Record<string, unknown>): GraphNode => ({
  elementId: '4:unit-1',
  labels: ['Nts449'],
  properties,
})

/** Runner capturing every statement, returning one record with a __id */
const mockRunner = (): {
  runner: Runner
  calls: { query: string; params: Record<string, unknown> }[]
} => {
  const calls: { query: string; params: Record<string, unknown> }[] = []

  const runner: Runner = {
    run: async (query: string, params: Record<string, unknown>) => {
      calls.push({ query, params })

      return output([{ __id: '4:created' }])
    },
  }

  return { runner, calls }
}

/** One hydratable row: the node under hydrate()'s default alias */
const nodeRow = (properties: Record<string, unknown>): Record<string, unknown> => ({
  this: node(properties),
})

// ---------------------------------------------------------------------------

describe('in transforms (NTS-449)', () => {
  it('runs before validation on create and stores the transformed value', async () => {
    const { runner, calls } = mockRunner()

    await new CreateService(runner).create(getModel(TransformDoc)!, { role: 'admin' })

    // 'admin' alone fails the valid:['ADMIN'] rule, so the transform ran first
    expect(calls).toHaveLength(1)
    expect(calls[0].params['this_role']).toBe('ADMIN')
  })

  it('runs before validation on update', async () => {
    const { runner, calls } = mockRunner()

    // Hydrate to stash the elementId the update matches on
    const [entity] = hydrate(TransformDoc, output([nodeRow({ role: 'ADMIN' })]))

    await new UpdateService(runner).update(getModel(TransformDoc)!, entity, { role: 'admin' })

    expect(calls).toHaveLength(1)
    expect(JSON.stringify(calls[0].params)).toContain('ADMIN')
  })

  it('awaits async in-transforms', async () => {
    const { runner, calls } = mockRunner()

    await new CreateService(runner).create(getModel(AsyncDoc)!, { name: 'adam' })

    expect(calls[0].params['this_name']).toBe('async:adam')
  })
})

describe('out transforms (NTS-449)', () => {
  it('applies the out transform at hydration', () => {
    const [entity] = hydrate(OutDoc, output([nodeRow({ data: '{"a":1}' })]))

    expect((entity as Record<string, unknown>)['data']).toEqual({ a: 1 })
  })

  it('wraps out-transform failures in a NeodeError naming model and property', () => {
    expect(() => hydrate(OutFailDoc, output([nodeRow({ name: 'adam' })]))).toThrow(NeodeError)
    expect(() => hydrate(OutFailDoc, output([nodeRow({ name: 'adam' })]))).toThrow(
      /property "name".*Nts449OutFailDoc/,
    )
  })

  it('rejects async out-transforms at hydration (hydration is synchronous)', () => {
    expect(() => hydrate(OutAsyncDoc, output([nodeRow({ name: 'adam' })]))).toThrow(
      /async "out" transform/,
    )
  })
})

describe('vector write path (NTS-449)', () => {
  const schema = (): EntitySchema => getModel(VectorMovie)!

  it('renders a plain SET for the vector property on create; scalar siblings stay inline', async () => {
    const { runner, calls } = mockRunner()

    await new CreateService(runner).create(schema(), { title: 'Matrix', emb: [1, 2, 3] })

    expect(calls).toHaveLength(1)
    expect(calls[0].query).toContain('SET this.`emb` = $set_')
    // Scalar sibling is an inline CREATE pattern property, not a procedure
    expect(calls[0].query).toContain('title: $this_title')
    // The vector value rides its SET parameter, not the pattern
    expect(calls[0].params['this_emb']).toBeUndefined()
    expect(Object.values(calls[0].params)).toContainEqual([1, 2, 3])
  })

  it('renders the SET form on save (no identity: CREATE path) with inline scalar siblings', async () => {
    const { runner, calls } = mockRunner()

    await new MergeService(runner).save({ title: 'Matrix', emb: [1, 2, 3] }, schema())

    expect(calls).toHaveLength(1)
    expect(calls[0].query).toContain('SET this.`emb` = $set_')
    // save() without a pk/unique property CREATEs (never a bare MERGE over
    // an arbitrary node) — the scalar sibling rides the inline pattern
    expect(calls[0].query).toContain('CREATE (this:VectorMovie { title: $this_title })')
  })

  it('splits vector properties out of the += map on update', async () => {
    const { runner, calls } = mockRunner()

    const [entity] = hydrate(VectorMovie, output([nodeRow({ title: 'Matrix' })]))

    await new UpdateService(runner).update(schema(), entity, {
      title: 'Matrix Reloaded',
      emb: [4, 5, 6],
    })

    expect(calls).toHaveLength(1)
    // The vector assignment rides the coalesced SET clause
    expect(calls[0].query).toContain('this.`emb` = $set_')

    // The += map carries only the scalar sibling
    const mapParam = Object.values(calls[0].params).find(
      (value) => typeof value === 'object' && value !== null && 'title' in (value as object),
    )
    expect(mapParam).toEqual({ title: 'Matrix Reloaded' })
  })
})

describe('embedding sugar: from + provider (NTS-449)', () => {
  it('computes the vector from the source property via the provider', async () => {
    const provider = vi.fn((text: string) => Promise.resolve([text.length, 0.5, 1]))
    const { model } = defineEmbedDoc(provider, 'Nts449EmbedDoc')

    const { runner, calls } = mockRunner()

    await new CreateService(runner).create(getModel(model)!, { plot: 'A hero rises' })

    expect(provider).toHaveBeenCalledWith('A hero rises')
    expect(calls[0].query).toContain('SET this.`emb` = $set_')
    expect(Object.values(calls[0].params)).toContainEqual([12, 0.5, 1])
  })

  it('does not call the provider when an explicit vector value is provided', async () => {
    const provider = vi.fn((text: string) => Promise.resolve([1, 0.5, 1]))
    const { model } = defineEmbedDoc(provider, 'Nts449ExplicitDoc')

    const { runner, calls } = mockRunner()

    await new CreateService(runner).create(getModel(model)!, {
      plot: 'A hero rises',
      emb: [9, 9, 9],
    })

    expect(provider).not.toHaveBeenCalled()
    // The explicit vector wins and is stored via the procedure
    expect(Object.values(calls[0].params)).toContainEqual([9, 9, 9])
  })

  it('does not compute when the source property is not in the payload', async () => {
    const provider = vi.fn((text: string) => Promise.resolve([1, 0.5, 1]))
    const { model } = defineEmbedDoc(provider, 'Nts449NoSourceDoc')

    const { runner, calls } = mockRunner()

    await new CreateService(runner).create(getModel(model)!, { emb: [7, 7, 7] })

    expect(provider).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
    expect(Object.values(calls[0].params)).toContainEqual([7, 7, 7])
  })

  it('surfaces provider failures as a descriptive NeodeError', async () => {
    const { model } = defineEmbedDoc(
      () => Promise.reject(new Error('quota exceeded')),
      'Nts449BoomDoc',
    )

    const { runner, calls } = mockRunner()

    const attempt = new CreateService(runner).create(getModel(model)!, { plot: 'text' })

    await expect(attempt).rejects.toThrow(NeodeError)
    await expect(
      new CreateService(runner).create(getModel(model)!, { plot: 'text' }),
    ).rejects.toThrow(/property "emb".*Nts449BoomDoc.*quota exceeded/)

    expect(calls).toHaveLength(0)
  })
})

describe('vector round trip: save stores the vector, out transform on read (NTS-440)', () => {
  it('stores the provider-computed vector and applies the out transform at hydration', async () => {
    const provider = vi.fn((text: string) => Promise.resolve([text.length, 0.5, 1]))

    const model = defineModel('Nts440RoundTrip', {
      plot: 'string',
      emb: {
        type: 'any',
        vector: { dimensions: 3, from: 'plot', provider },
        // Reversing proves the out transform ran over the stored vector
        transform: {
          out: (value: unknown) => (Array.isArray(value) ? [...value].reverse() : value),
        },
      },
    })

    const { runner, calls } = mockRunner()

    await new CreateService(runner).create(getModel(model)!, { plot: 'A hero rises' })

    // The stored value is the vector, not the source text
    expect(Object.values(calls[0].params)).toContainEqual([12, 0.5, 1])

    const [entity] = hydrate(model, output([nodeRow({ plot: 'A hero rises', emb: [12, 0.5, 1] })]))

    expect((entity as Record<string, unknown>)['emb']).toEqual([1, 0.5, 12])
  })
})

describe('recompute only when the source is dirty (NTS-440)', () => {
  const defineTrackedEmbedDoc = (provider: (text: string) => Promise<number[]>, name: string) =>
    defineModel(name, {
      id: { type: 'string', primary: true },
      title: 'string',
      emb: { type: 'any', vector: { dimensions: 3, from: 'title', provider } },
    })

  it('recomputes the vector from a dirty source and writes it even though the vector itself is clean', async () => {
    const provider = vi.fn((text: string) => Promise.resolve([text.length, 0.5, 1]))
    const schema = getModel(defineTrackedEmbedDoc(provider, 'Nts440DirtySource'))!

    const { runner, calls } = mockRunner()

    // Tracked save: only `title` changed; `emb` carries its stale stored value
    await new MergeService(runner).save(
      { id: '1', title: 'A rewritten title', emb: [0, 0, 0] },
      schema,
      new Set(['title']),
    )

    expect(provider).toHaveBeenCalledWith('A rewritten title')
    // The stale vector is not written; the recomputed one is
    expect(Object.values(calls[0].params)).not.toContainEqual([0, 0, 0])
    expect(Object.values(calls[0].params)).toContainEqual([17, 0.5, 1])
  })

  it('keeps the vector without a provider call when the vector itself is dirty', async () => {
    const provider = vi.fn((text: string) => Promise.resolve([1, 0.5, 1]))
    const schema = getModel(defineTrackedEmbedDoc(provider, 'Nts440DirtyVector'))!

    const { runner, calls } = mockRunner()

    await new MergeService(runner).save(
      { id: '1', title: 'A new title', emb: [7, 7, 7] },
      schema,
      new Set(['title', 'emb']),
    )

    expect(provider).not.toHaveBeenCalled()
    expect(Object.values(calls[0].params)).toContainEqual([7, 7, 7])
  })

  it('pays no provider call when neither the source nor the vector is dirty', async () => {
    const provider = vi.fn((text: string) => Promise.resolve([1, 0.5, 1]))
    const schema = getModel(defineTrackedEmbedDoc(provider, 'Nts440CleanSave'))!

    const { runner, calls } = mockRunner()

    await new MergeService(runner).save(
      { id: '1', title: 'Unchanged', emb: [0, 0, 0] },
      schema,
      new Set(),
    )

    expect(provider).not.toHaveBeenCalled()
  })
})
