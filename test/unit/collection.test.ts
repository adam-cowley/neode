import neo4j from 'neo4j-driver'
import {
  NodeEntity,
  InternalId,
  Uuid,
  String,
  Date,
  DateTime,
  LocalTime,
  LocalDateTime,
  Time,
  Duration,
  Point,
  OneToMany,
} from '../../src/decorators'
import { Direction } from '../../src/query'
import { mergeModel, mergeProperty } from '../../src/meta'
import { PropertyType } from '../../src/meta/property-schema'
import { Collection } from '../../src/collection'
import { toJson } from '../../src/serialise'

// ---- Fixtures (decorator registry is global per module registry) -----------

@NodeEntity()
class Person {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String()
  name: string

  @String({ hidden: true })
  secret: string

  @Date()
  born: unknown

  @DateTime()
  createdAt: unknown

  @LocalTime()
  opens: unknown

  @LocalDateTime()
  updated: unknown

  @Time()
  time: unknown

  @Duration()
  tenure: unknown

  @Point()
  location: unknown

  @OneToMany(() => Person, 'KNOWS', Direction.OUTGOING)
  friends: Person[]

  static build(values: Record<string, unknown>): Person {
    return Object.assign(new Person(), values) as unknown as Person
  }
}

// Internal/node property types are set through the meta API directly
class GrabBag {
  name: string

  everything: unknown

  nodeId: unknown
}
mergeProperty(GrabBag, 'name', PropertyType.STRING)
mergeProperty(GrabBag, 'everything', PropertyType.ALL_PROPERTIES)
mergeProperty(GrabBag, 'nodeId', PropertyType.NODE)
mergeModel(GrabBag).setLabels(['GrabBag'])

@NodeEntity()
class NoInternalId {
  @String()
  name: string
}

// ---------------------------------------------------------------------------

describe('Collection', () => {
  describe('array behaviours', () => {
    it('exposes length', () => {
      expect(new Collection([1, 2, 3]).length).toBe(3)
      expect(new Collection().length).toBe(0)
    })

    it('is iterable', () => {
      expect([...new Collection([1, 2, 3])]).toEqual([1, 2, 3])
    })

    it('gets a value by index', () => {
      expect(new Collection(['a', 'b']).get(1)).toBe('b')
      expect(new Collection(['a', 'b']).get(9)).toBeUndefined()
    })

    it('returns the first value', () => {
      expect(new Collection(['a', 'b']).first()).toBe('a')
      expect(new Collection().first()).toBeUndefined()
    })

    it('maps values', () => {
      expect(new Collection([1, 2]).map((value) => value * 2)).toEqual([2, 4])
    })

    it('finds a value', () => {
      expect(new Collection([1, 2, 3]).find((value) => value > 1)).toBe(2)
      expect(new Collection([1]).find((value) => value > 5)).toBeUndefined()
    })

    it('runs a function on all values', () => {
      const seen: number[] = []

      new Collection([1, 2]).forEach((value) => seen.push(value))

      expect(seen).toEqual([1, 2])
    })

    it('creates a collection from an iterable', () => {
      const collection = Collection.from([1, 2, 3])

      expect(collection).toBeInstanceOf(Collection)
      expect(collection.length).toBe(3)
      expect(collection.get(2)).toBe(3)
    })
  })

  describe('toJson', () => {
    it('maps toJson over every value', async () => {
      const collection = new Collection([
        Person.build({ name: 'Adam', _id: '4:abc:1' }),
        Person.build({ name: 'Ada', _id: '4:abc:2' }),
      ])

      expect(await collection.toJson()).toEqual([
        { _id: '4:abc:1', _labels: ['Person'], name: 'Adam' },
        { _id: '4:abc:2', _labels: ['Person'], name: 'Ada' },
      ])
    })

    it('resolves to an empty array for an empty collection', async () => {
      expect(await new Collection().toJson()).toEqual([])
    })
  })
})

describe('toJson', () => {
  it('outputs plain properties and skips hidden ones', () => {
    const output = toJson(Person.build({ name: 'Adam', secret: 's3cret' }))

    expect(output.name).toBe('Adam')
    expect(output).not.toHaveProperty('secret')
  })

  it('omits properties that have not been set', () => {
    const output = toJson(Person.build({ name: 'Adam' }))

    expect(output).not.toHaveProperty('born')
    expect(output).not.toHaveProperty('location')
  })

  it('includes _id from the internal id property and _labels from the schema', () => {
    const output = toJson(Person.build({ name: 'Adam', _id: '4:abc:1' }))

    expect(output._id).toBe('4:abc:1')
    expect(output._labels).toEqual(['Person'])
  })

  it('outputs a null _id when unset or when the model has no internal id', () => {
    expect(toJson(Person.build({ name: 'Adam' }))._id).toBe(null)

    const output = toJson(Object.assign(new NoInternalId(), { name: 'Adam' }))

    expect(output._id).toBe(null)
    expect(output.name).toBe('Adam')
  })

  it('skips internal and node property types', () => {
    const entity = Object.assign(new GrabBag(), {
      name: 'grab',
      everything: { a: 1 },
      nodeId: { elementId: '4:abc:9' },
    })

    const output = toJson(entity)

    expect(output.name).toBe('grab')
    expect(output).not.toHaveProperty('everything')
    expect(output).not.toHaveProperty('nodeId')
  })

  it('throws for a value without a registered model', () => {
    class Unknown {}

    expect(() => toJson(new Unknown())).toThrow()
    expect(() => toJson(null)).toThrow()
  })

  describe('driver value conversion', () => {
    it('converts driver temporals to their ISO string form', () => {
      const output = toJson(
        Person.build({
          born: new neo4j.Date(2024, 3, 15),
          createdAt: new neo4j.DateTime(2024, 3, 15, 12, 30, 45, 0, 0, null),
          opens: new neo4j.LocalTime(12, 30, 45, 123000000),
          updated: new neo4j.LocalDateTime(2024, 3, 15, 12, 30, 45, 0),
          time: new neo4j.Time(12, 30, 45, 0, 0),
          tenure: new neo4j.Duration(1, 2, 3, 0),
        }),
      )

      expect(output.born).toBe('2024-03-15')
      expect(output.createdAt).toBe('2024-03-15T12:30:45Z')
      expect(output.opens).toBe('12:30:45.123000000')
      expect(output.updated).toBe('2024-03-15T12:30:45')
      expect(output.time).toBe('12:30:45Z')
      expect(output.tenure).toBe('P1M2DT3S')
    })

    it('converts driver points to a plain coordinate object', () => {
      const output = toJson(
        Person.build({
          location: new neo4j.Point(9157, 1, 2, 3),
        }),
      )

      expect(output.location).toEqual({ srid: 9157, x: 1, y: 2, z: 3 })
    })

    it('converts driver integers to numbers', () => {
      const output = toJson(Person.build({ name: neo4j.int(42) as unknown as string }))

      expect(output.name).toBe(42)
    })
  })

  describe('plain object conversion (embedded Relate values)', () => {
    it('converts plain object temporals to ISO strings', () => {
      const output = toJson(
        Person.build({
          born: { year: 2024, month: 3, day: 15 },
          createdAt: {
            year: 2024,
            month: 3,
            day: 15,
            hour: 12,
            minute: 30,
            second: 45,
            nanosecond: 123456789,
            offsetSeconds: 0,
            zone: null,
          },
          opens: { hour: 12, minute: 30, second: 45, nanosecond: 0 },
          updated: {
            year: 2024,
            month: 3,
            day: 15,
            hour: 12,
            minute: 30,
            second: 45,
            nanosecond: 0,
          },
          tenure: { months: 1, days: 2, seconds: 3, nanos: 0 },
        }),
      )

      expect(output.born).toBe('2024-03-15')
      expect(output.createdAt).toBe('2024-03-15T12:30:45.123456789Z')
      expect(output.opens).toBe('12:30:45')
      expect(output.updated).toBe('2024-03-15T12:30:45')
      expect(output.tenure).toBe('P1M2DT3S')
    })

    it('renders timezone information on plain object datetimes', () => {
      const output = toJson(
        Person.build({
          createdAt: {
            year: 2024,
            month: 3,
            day: 15,
            hour: 12,
            minute: 30,
            second: 45,
            nanosecond: 0,
            offsetSeconds: 3600,
            zone: 'Europe/London',
          },
        }),
      )

      expect(output.createdAt).toBe('2024-03-15T12:30:45+01:00[Europe/London]')
    })

    it('converts plain object points to a plain coordinate object', () => {
      const output = toJson(
        Person.build({
          location: { srid: 7203, x: 1, y: 2, z: undefined },
        }),
      )

      expect(output.location).toEqual({ srid: 7203, x: 1, y: 2 })
    })
  })

  describe('nested entities', () => {
    it('serialises arrays of nested entities', () => {
      const friend = Person.build({ name: 'Ada', _id: '4:abc:2' })
      const output = toJson(
        Person.build({
          name: 'Adam',
          _id: '4:abc:1',
          friends: [friend],
        }),
      )

      expect(output.friends).toEqual([{ _id: '4:abc:2', _labels: ['Person'], name: 'Ada' }])
    })

    it('serialises a single nested entity', () => {
      const output = toJson(
        Person.build({
          name: 'Adam',
          _id: '4:abc:1',
          friends: Person.build({ name: 'Ada', _id: '4:abc:2' }) as unknown as Person[],
        }),
      )

      expect(output.friends).toEqual({
        _id: '4:abc:2',
        _labels: ['Person'],
        name: 'Ada',
      })
    })

    it('serialises entities nested in plain property arrays', () => {
      const output = toJson(
        Person.build({
          name: 'Adam',
          _id: '4:abc:1',
          friends: [],
          born: [
            new neo4j.Date(2024, 3, 15),
            { year: 2020, month: 1, day: 2 },
          ] as unknown as unknown,
        }),
      )

      expect(output.born).toEqual(['2024-03-15', '2020-01-02'])
    })
  })
})
