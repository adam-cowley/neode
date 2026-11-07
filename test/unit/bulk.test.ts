import { NodeEntity, Uuid, String, Number, InternalId, OneToMany } from '../../src/decorators'
import { Direction } from '../../src/query'
import { getModel } from '../../src/meta'
import { ValidationError } from '../../src/validation'
import {
  buildCreateQuery,
  buildMergeQuery,
  chunk,
  processCreateRow,
  processMergeRow,
} from '../../src/services/query/bulk.service'
import { toCursorValue } from '../../src/services/query/paginate.service'
import { PropertySchema, PropertyType } from '../../src/meta/property-schema'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class BulkPerson {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ min: 2 })
  name: string

  @Number()
  age: number
}

@NodeEntity()
class BulkAccount {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  name: string

  @String({ index: true })
  slug: string

  @Number()
  visits: number
}

@NodeEntity()
class BulkPost {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @OneToMany(() => BulkPerson, 'WROTE', Direction.OUTGOING)
  author: BulkPerson
}

const FIXED_UUID = '0c0ffee0-0000-4000-8000-000000000000'

// ---------------------------------------------------------------------------

describe('bulk helpers', () => {
  describe('chunk', () => {
    it('splits rows into equal chunks', () => {
      const rows = [1, 2, 3, 4, 5, 6]

      expect(chunk(rows, 2)).toEqual([
        [1, 2],
        [3, 4],
        [5, 6],
      ])
    })

    it('keeps a trailing remainder chunk', () => {
      expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    })

    it('returns one chunk when the chunk size exceeds the rows', () => {
      expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]])
    })

    it('returns no chunks for no rows', () => {
      expect(chunk([], 5)).toEqual([])
    })

    it('rejects a non-positive or non-integer chunk size', () => {
      expect(() => chunk([1], 0)).toThrow(/chunkSize/i)
      expect(() => chunk([1], -1)).toThrow(/chunkSize/i)
      expect(() => chunk([1], 1.5)).toThrow(/chunkSize/i)
    })
  })

  describe('processCreateRow', () => {
    it('resolves schema defaults and skips internal properties', () => {
      const schema = getModel(BulkPerson)!
      const row = { name: 'Adam', age: 30 }

      const map = processCreateRow(row, schema)

      expect(Object.keys(map).sort()).toEqual(['age', 'id', 'name'])
      expect(map.name).toBe('Adam')
      expect(map.age).toBe(30)
      expect(map.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })

    it('drops undefined and null values like the single-create path', () => {
      const schema = getModel(BulkPerson)!

      const map = processCreateRow({ name: 'Adam', age: null }, schema)

      expect(Object.keys(map).sort()).toEqual(['id', 'name'])
    })

    it('keeps explicitly set values without regenerating defaults', () => {
      const schema = getModel(BulkPerson)!

      const map = processCreateRow({ id: FIXED_UUID, name: 'Adam' }, schema)

      expect(map.id).toBe(FIXED_UUID)
    })

    it('throws a ValidationError for an invalid row', () => {
      const schema = getModel(BulkPerson)!

      expect(() => processCreateRow({ name: 'a' }, schema)).toThrow(ValidationError)
    })

    it('rejects rows carrying relationship values (bulk create is flat)', () => {
      const schema = getModel(BulkPost)!

      expect(() => processCreateRow({ author: { name: 'Adam' } }, schema)).toThrow(/relationship/i)
    })
  })

  describe('processMergeRow', () => {
    it('matches on explicitly set merge fields without defaulting them', () => {
      const schema = getModel(BulkAccount)!

      const { match, set } = processMergeRow({ name: 'adam', visits: 5 }, schema)

      expect(match).toEqual({ name: 'adam' })
      expect(set).toEqual({ visits: 5 })
    })

    it('matches on every explicitly set merge field (primary key included)', () => {
      const schema = getModel(BulkAccount)!

      const { match, set } = processMergeRow({ id: FIXED_UUID, name: 'adam' }, schema)

      expect(match).toEqual({ id: FIXED_UUID, name: 'adam' })
      expect(set).toEqual({})
    })

    it('throws when a row sets no merge field', () => {
      const schema = getModel(BulkAccount)!

      expect(() => processMergeRow({ visits: 5 }, schema)).toThrow(/merge/i)
    })

    it('does not default-resolve merge keys that are not set', () => {
      const schema = getModel(BulkAccount)!

      // id is a primary key with a UUID default: it must not sneak into
      // the SET map, or every merge would create a fresh node
      const { set } = processMergeRow({ name: 'adam' }, schema)

      expect(set).not.toHaveProperty('id')
    })

    it('validates the combined match and set values', () => {
      const schema = getModel(BulkAccount)!

      expect(() => processMergeRow({ name: 'adam', visits: 'not-a-number' }, schema)).toThrow(
        ValidationError,
      )
    })
  })

  describe('query builders', () => {
    it('builds the bulk CREATE statement around UNWIND', () => {
      const query = buildCreateQuery(['BulkPerson'])

      expect(query).toContain('UNWIND $rows AS row')
      expect(query).toContain('CREATE (this:BulkPerson)')
      expect(query).toContain('SET this += row')
      expect(query).toContain('RETURN this')
    })

    it('joins multiple labels', () => {
      expect(buildCreateQuery(['A', 'B'])).toContain('CREATE (this:A:B)')
    })

    it('builds the bulk MERGE statement on the given match keys', () => {
      const query = buildMergeQuery(['BulkAccount'], ['id', 'name'])

      expect(query).toContain('UNWIND $rows AS row')
      expect(query).toContain('MERGE (this:BulkAccount { id: row.id, name: row.name })')
      expect(query).toContain('SET this += row')
      expect(query).toContain('RETURN this')
    })
  })

  describe('toCursorValue', () => {
    const datetime = new PropertySchema('createdAt')
    datetime.setType(PropertyType.DATETIME)

    const visits = new PropertySchema('visits')
    visits.setType(PropertyType.NUMBER)

    it('formats a Relate temporal object as an ISO instant', () => {
      expect(
        toCursorValue(
          {
            year: 2026,
            month: 1,
            day: 2,
            hour: 3,
            minute: 4,
            second: 5,
            nanosecond: 0,
            offsetSeconds: 0,
            zone: null,
          },
          datetime,
        ),
      ).toBe('2026-01-02T03:04:05Z')
    })

    it('passes portable values through and drops unusable ones', () => {
      expect(toCursorValue(7, visits)).toBe(7)
      expect(toCursorValue('2026-01-02T03:04:05Z', datetime)).toBe('2026-01-02T03:04:05Z')
      expect(toCursorValue(undefined, datetime)).toBeUndefined()
      expect(toCursorValue(null, datetime)).toBeUndefined()
    })
  })
})
