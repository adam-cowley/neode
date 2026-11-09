import { describe, expect, it, vi } from 'vitest'
import { MergeService } from '../../src/services/query/merge.service'
import { UpdateService } from '../../src/services/query/update.service'
import { buildCreateQuery, buildMergeQuery } from '../../src/services/query/bulk.service'
import { deriveProperties } from '../../src/services/write-utilities'
import { EntitySchema } from '../../src/meta/entity/entity-schema'
import { PropertyType } from '../../src/meta/property-schema'
import { getModel } from '../../src/meta'
import { defineModel } from '../../src/meta/map-schema'
import { Derived, NodeEntity, Number } from '../../src/decorators'
import { getModelByName } from '../../src/meta/map-schema'
import type { Runner } from '../../src/driver/types'

function schemaWithDerived(
  derived: {
    key: string
    from: string[]
    compute?: (entity: Record<string, unknown>) => unknown
    cypher?: string
  }[],
  propertyKeys: string[] = ['a', 'b'],
  primaryKeys: string[] = ['id'],
): EntitySchema {
  const schema = new EntitySchema()

  schema.setLabels(['Thing'])

  for (const key of ['id', ...propertyKeys]) {
    schema.addProperty(key)
    schema.getProperty(key).setType(PropertyType.NUMBER)

    if (primaryKeys.includes(key)) {
      schema.getProperty(key).setPrimaryKey(true)
    }
  }

  for (const { key, from, compute, cypher } of derived) {
    schema.addProperty(key)
    schema.getProperty(key).setType(PropertyType.NUMBER)
    schema.getProperty(key).setDerived({ from, compute, cypher })
  }

  return schema
}

const runner = (): Runner =>
  ({
    run: vi.fn(() =>
      Promise.resolve({
        records: [
          {
            get: (key: string) => (key === '__id' ? '4:unit:derived' : undefined),
            has: (key: string) => key === '__id',
            keys: ['__id'],
          },
        ],
        summary: { counters: { nodesCreated: 1 } },
      }),
    ),
  }) as unknown as Runner

describe('@Derived registration (NTS-569)', () => {
  it('stacks with a type decorator and merges onto the property', () => {
    @NodeEntity()
    class DerivedThing {
      @Number()
      a: unknown

      @Number()
      @Derived({ from: ['a'], compute: (entity) => entity['a'] })
      twice: unknown
    }

    const schema = getModel(DerivedThing)

    expect(schema?.getProperty('twice').getDerived()?.from).toEqual(['a'])
    expect(schema?.getProperty('twice').getType()).toBe(PropertyType.NUMBER)
  })

  it('accepts the map-API `derived` key', () => {
    defineModel('DerivedMapThing', {
      a: { type: 'number' },
      twice: {
        type: 'number',
        derived: { from: ['a'], compute: (entity) => entity['a'] },
      },
    })

    const constructor = getModelByName('DerivedMapThing')
    const schema = constructor === undefined ? undefined : getModel(constructor)

    expect(schema?.getProperty('twice').getDerived()?.from).toEqual(['a'])
  })
})

describe('deriveProperties (NTS-569)', () => {
  it('computes the value onto the payload when a source is written', () => {
    const schema = schemaWithDerived([
      {
        key: 'sum',
        from: ['a', 'b'],
        compute: (entity) => (entity['a'] as number) + (entity['b'] as number),
      },
    ])

    const values = { a: 1, b: 2 }

    const result = deriveProperties(schema, values)

    expect(result.recomputed).toEqual(['sum'])
    expect(values['sum']).toBe(3)
  })

  it('skips when no source is in the payload', () => {
    const schema = schemaWithDerived([{ key: 'sum', from: ['a', 'b'], compute: () => 99 }])

    const values = { unrelated: 1 }

    const result = deriveProperties(schema, values)

    expect(result.recomputed).toEqual([])
    expect(values['sum']).toBeUndefined()
  })

  it('skips when a source is absent or null — a partial source set leaves the stored value alone', () => {
    const schema = schemaWithDerived([{ key: 'sum', from: ['a', 'b'], compute: () => 99 }])

    const absent = { a: 1 }
    const nulled = { a: 1, b: null }

    expect(deriveProperties(schema, absent).recomputed).toEqual([])
    expect(deriveProperties(schema, nulled).recomputed).toEqual([])
  })

  it('an explicitly provided derived value wins over recomputation', () => {
    const schema = schemaWithDerived([{ key: 'sum', from: ['a', 'b'], compute: () => 99 }])

    const values = { a: 1, b: 2, sum: 50 }

    const result = deriveProperties(schema, values)

    expect(result.recomputed).toEqual([])
    expect(values['sum']).toBe(50)
  })

  it('a tracked save recomputes only from a dirty source; a dirty derived key wins', () => {
    const schema = schemaWithDerived([
      {
        key: 'sum',
        from: ['a', 'b'],
        compute: (entity) => (entity['a'] as number) + (entity['b'] as number),
      },
    ])

    // b is dirty, a is clean but present on the entity record: recompute
    const tracked = deriveProperties(schema, { a: 1, b: 5, sum: 3 }, new Set(['b']))

    expect(tracked.recomputed).toEqual(['sum'])
    expect(tracked.cypherSets).toEqual([])

    // the derived key itself is dirty: the user's value wins
    const explicit = deriveProperties(schema, { a: 1, b: 5, sum: 3 }, new Set(['sum']))

    expect(explicit.recomputed).toEqual([])

    // no dirty source: no recompute
    const clean = deriveProperties(
      schema,
      { a: 1, b: 5 },
      new Set(['a' === 'a' ? 'unrelated' : 'a']),
    )

    expect(clean.recomputed).toEqual([])
  })

  it('cypher-side derivation returns the expression instead of computing', () => {
    const schema = schemaWithDerived([{ key: 'double', from: ['a'], cypher: 'this.a * 2' }])

    const result = deriveProperties(schema, { a: 21 })

    expect(result.recomputed).toEqual([])
    expect(result.cypherSets).toEqual([{ key: 'double', cypher: 'this.a * 2' }])
  })

  it('rejects a definition with both or neither producer', () => {
    const both = schemaWithDerived([
      { key: 'bad', from: ['a'], compute: () => 1, cypher: 'this.a' },
    ])

    expect(() => deriveProperties(both, { a: 1 })).toThrow(/exactly one/)

    const neither = schemaWithDerived([{ key: 'bad', from: ['a'] }])

    expect(() => deriveProperties(neither, { a: 1 })).toThrow(/neither compute nor cypher/)
  })

  it('rejects a source that is not a declared property', () => {
    const schema = schemaWithDerived([{ key: 'bad', from: ['typo'], compute: () => 1 }])

    expect(() => deriveProperties(schema, { a: 1 })).toThrow(
      /every source must be a property declared/,
    )
  })
})

describe('derived property statement shapes (NTS-569)', () => {
  it('merge save: a compute-derived dirty key joins the tracked write set', async () => {
    const runnerSpy = runner()
    const service = new MergeService(runnerSpy)

    const schema = schemaWithDerived([
      {
        key: 'sum',
        from: ['a', 'b'],
        compute: (entity) => (entity['a'] as number) + (entity['b'] as number),
      },
    ])

    const entity = { id: 1, a: 1, b: 7, sum: 1 }

    await service.save(entity, schema, new Set(['b']))

    const [query, params] = (runnerSpy.run as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]

    expect(query).toContain('MERGE (this:Thing')

    // only the dirty source (b) and the recomputed sum are written — the
    // clean a and the stale sum 1 stay out of the statement
    // param items stay one clause; the recomputed sum is among them
    expect(query).toContain('SET this.b = $set_0, this.sum = $set_1')
    expect(query).not.toContain('this.a =')

    expect(Object.values(params)).toContain(8)
  })

  it('merge save: a cypher-derived property renders SET after the sources', async () => {
    const runnerSpy = runner()
    const service = new MergeService(runnerSpy)

    const schema = schemaWithDerived([{ key: 'double', from: ['b'], cypher: 'this.b * 2' }])

    await service.save({ id: 1, a: 1, b: 7 }, schema, new Set(['b']))

    const query = (runnerSpy.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string

    // cypher: its own SET clause, rendered after the source items
    expect(query).toContain('SET this.`double` = this.b * 2')

    const setIndex = query.indexOf('this.b = $set_0')
    const derivedIndex = query.indexOf('this.`double`')

    expect(derivedIndex).toBeGreaterThan(setIndex)
  })

  it('update: the patch triggers the recompute over the stored sources', async () => {
    const runnerSpy = runner()
    const service = new UpdateService(runnerSpy)

    const schema = schemaWithDerived(
      [
        {
          key: 'sum',
          from: ['a', 'b'],
          compute: (entity) => (entity['a'] as number) + (entity['b'] as number),
        },
        { key: 'double', from: ['b'], cypher: 'this.b * 2' },
      ],
      ['a', 'b'],
    )

    const entity = { id: 1, a: 1, b: 7 }

    await service.update(schema, entity, { b: 10 })

    const [query, params] = (runnerSpy.run as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]

    // compute: stored a (1) + patched b (10) = 11, written with the patch
    expect(JSON.stringify(params)).toContain('"sum":11')

    // cypher: expression rendered into the statement
    expect(query).toContain('this.`double` = this.b * 2')

    const setIndex = query.indexOf('this.`b`')
    const derivedIndex = query.indexOf('this.`double`')

    expect(derivedIndex).toBeGreaterThan(setIndex)
  })

  it('bulk: the derived SET clause renders after `SET this += row`, coalesced with the row value', () => {
    const createQuery = buildCreateQuery(
      ['Thing'],
      [],
      ['this.doubleA = coalesce(row.doubleA, this.a * 2)'],
    )

    expect(createQuery).toContain(
      'SET this += row\nSET this.doubleA = coalesce(row.doubleA, this.a * 2)',
    )

    const mergeQuery = buildMergeQuery(
      ['Thing'],
      ['id'],
      [],
      [],
      [],
      ['this.doubleA = coalesce(row.doubleA, this.a * 2)'],
    )

    expect(mergeQuery).toContain(
      'SET this += row\nSET this.doubleA = coalesce(row.doubleA, this.a * 2)',
    )
  })
})
