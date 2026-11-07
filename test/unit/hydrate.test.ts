import { defineModel } from '../../src/meta/map-schema'
import { Collection } from '../../src/collection'
import { hydrate, hydrateFirst, toCollection } from '../../src/hydrate'
import { GraphNode, QueryOutput, QueryRecord } from '../../src/driver/types'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

const Pet = defineModel('HydratePet', {
  name: 'string',
})

const Person = defineModel('HydratePerson', {
  name: { type: 'string', unique: true },
  pets: { type: 'node', relationship: 'OWNS', direction: 'out', target: 'HydratePet' },
})

// The virtual constructors type as Newable (unknown instances) — the test
// asserts on the hydrated shape instead of the class type
interface HydratedPerson {
  _id: string
  name: string
  pets?: { name: string }
}

const node = (properties: Record<string, unknown>, label = 'HydratePerson'): GraphNode => ({
  elementId: '4:unit-1',
  labels: [label],
  properties,
})

const record = (values: Record<string, unknown>): QueryRecord => ({
  get: (key) => values[key],
  has: (key) => Object.hasOwn(values, key),
  keys: Object.keys(values),
})

const output = (records: Record<string, unknown>[]): QueryOutput => ({
  records: records.map(record),
})

// ---------------------------------------------------------------------------

describe('hydrate', () => {
  it('maps result records into typed entities', () => {
    const entities = hydrate(
      Person,
      output([{ this: node({ name: 'Adam' }) }, { this: node({ name: 'Ada' }) }]),
    ) as HydratedPerson[]

    expect(entities).toHaveLength(2)
    expect(entities[0]).toBeInstanceOf(Person)
    expect(entities[0].name).toBe('Adam')
    expect(entities[1].name).toBe('Ada')
    expect(entities[0]._id).toBe('4:unit-1')
  })

  it('plucks a custom alias column', () => {
    const entities = hydrate(
      Person,
      output([{ node: node({ name: 'Adam' }) }]),
      'node',
    ) as HydratedPerson[]

    expect(entities).toHaveLength(1)
    expect(entities[0].name).toBe('Adam')
  })

  it('returns an empty array when the alias column is missing or null', () => {
    // OPTIONAL MATCH miss (null column) and rows without the alias at all
    const entities = hydrate(
      Person,
      output([{ this: null }, { other: node({ name: 'Adam' }) }, {}]),
    )

    expect(entities).toEqual([])
  })

  it('hydrates extra record columns as eager relationship values', () => {
    const entities = hydrate(
      Person,
      output([{ this: node({ name: 'Adam' }), pets: node({ name: 'Rex' }, 'HydratePet') }]),
    ) as HydratedPerson[]

    expect(entities).toHaveLength(1)
    expect(entities[0].pets).toBeInstanceOf(Pet)
    expect(entities[0].pets!.name).toBe('Rex')
  })

  it('ignores extra columns that are not schema relationships', () => {
    const entities = hydrate(
      Person,
      output([{ this: node({ name: 'Adam' }), total: 2 }]),
    ) as HydratedPerson[]

    expect(entities).toHaveLength(1)
    expect(entities[0].name).toBe('Adam')
  })

  it('throws when no model is registered for the constructor', () => {
    class Unknown {}

    expect(() => hydrate(Unknown, output([]))).toThrow(/Unknown/)
  })

  describe('hydrateFirst', () => {
    it('returns the first hydrated entity', () => {
      const entity = hydrateFirst(
        Person,
        output([{ this: node({ name: 'Adam' }) }, { this: node({ name: 'Ada' }) }]),
      ) as HydratedPerson | undefined

      expect(entity).toBeInstanceOf(Person)
      expect(entity!.name).toBe('Adam')
    })

    it('returns undefined for an empty result set', () => {
      expect(hydrateFirst(Person, output([]))).toBeUndefined()
    })
  })

  describe('toCollection', () => {
    it('wraps the hydrated entities in a Collection', () => {
      const collection = toCollection(
        Person,
        output([{ this: node({ name: 'Adam' }) }, { this: node({ name: 'Ada' }) }]),
      ) as Collection<HydratedPerson>

      expect(collection).toBeInstanceOf(Collection)
      expect(collection.length).toBe(2)
      expect(collection.first()!.name).toBe('Adam')
    })

    it('returns an empty Collection when the alias column is missing', () => {
      const collection = toCollection(Person, output([{}]))

      expect(collection.length).toBe(0)
    })
  })
})
