import {
  NodeEntity,
  Uuid,
  String,
  Number,
  InternalId,
  OneToMany,
  OneToOne,
  Property,
  Boolean,
  RelationshipEntity,
  StartNode,
  EndNode,
} from '../../src/decorators'
import { Direction } from '../../src/query'
import { getModel } from '../../src/meta'
import { ValidationError } from '../../src/validation'
import { NeodeError } from '../../src/errors'
import { convertEdgeProperties } from '../../src/services/relationship-values'
import {
  buildCreateQuery,
  buildMergeQuery,
  buildRelateQuery,
  chunk,
  prepareRows,
  processCreateRow,
  processMergeRow,
  rowToProperties,
  BulkService,
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

@NodeEntity()
class BulkOneAuthor {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @OneToOne({ target: () => BulkPerson, type: 'WROTE', direction: Direction.OUTGOING })
  author: BulkPerson
}

@RelationshipEntity()
class BulkOwnership {
  @Uuid({ primary: true })
  id: string

  @StartNode(() => BulkPerson)
  owner: BulkPerson

  @EndNode(() => BulkPost)
  post: BulkPost
}

@NodeEntity()
class BulkEdgeOwner {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @OneToMany(() => BulkOwnership, 'OWNS', Direction.OUTGOING)
  ownership: BulkOwnership[]
}

@NodeEntity()
class BulkNoPk {
  @InternalId()
  _id: string

  @OneToMany(() => BulkNoPk, 'KNOWS', Direction.OUTGOING)
  knows: BulkNoPk[]
}

// A model without an explicit @Primary still has a primary key:
// getPrimaryKey() falls back to a phantom <label>_id property —
// relateMany matches on it like any other pk.

let fakeSequence = 0

@NodeEntity()
class BulkBadge {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true, fake: () => `slug-${++fakeSequence}` })
  slug: string

  @Property({ type: 'string', required: true, fake: () => `code-${++fakeSequence}` })
  code: string

  @Property({ type: 'string', fake: () => `tag-${++fakeSequence}` })
  tag: string
}

@NodeEntity()
class BulkFlagged {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Boolean()
  active: boolean
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

  describe('fake generators (NTS-608)', () => {
    it('resolves fake properties in createMany rows like single create', async () => {
      const schema = getModel(BulkBadge)!
      const rows = [{}, {}, {}]

      const { rows: prepared } = await prepareRows(rows, schema)
      const maps = prepared.map((row) => processCreateRow(row, schema))

      // The required fake property: rows validate (no throw) and every
      // row carries a generated value
      const codes = maps.map((map) => map.code)
      expect(codes.every((code) => typeof code === 'string' && code.startsWith('code-'))).toBe(true)

      // Distinct within the batch (generator-side; bulk does not retry)
      expect(new Set(codes).size).toBe(rows.length)

      // The plain fake property is present too
      expect(maps.every((map) => typeof map.tag === 'string' && map.tag.startsWith('tag-'))).toBe(
        true,
      )
    })

    it('resolves fakes in mergeMany rows before the match/set split', async () => {
      const schema = getModel(BulkBadge)!

      // No explicit merge field: the faked unique property supplies the
      // match (a fresh value per row — merge creates, like single merge())
      const { rows: prepared } = await prepareRows([{}], schema)
      const [row] = prepared
      const { match, set } = processMergeRow(row!, schema)

      expect(match.slug).toMatch(/^slug-/)
      expect(set).not.toHaveProperty('slug')
      // The required fake property is written like any other value
      expect(set.code).toMatch(/^code-/)
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

      expect(query).toContain('UNWIND $rows AS item')
      expect(query).toContain('WITH item.row AS row, item.create AS created')
      expect(query).toContain('MERGE (this:BulkAccount { id: row.id, name: row.name })')
      expect(query).toContain('SET this += row')
      expect(query).toContain('RETURN this')
    })

    it('builds the relateMany statement: MATCH both pks, MERGE the edge, upsert props', () => {
      const query = buildRelateQuery(
        ['BulkPost'],
        ['BulkPerson'],
        'WROTE',
        Direction.OUTGOING,
        'id',
        'id',
      )

      expect(query).toContain('UNWIND $rows AS row')
      expect(query).toContain('MATCH (from:BulkPost { id: row.from })')
      expect(query).toContain('MATCH (to:BulkPerson { id: row.to })')
      // Endpoints are MATCH-bound — the MERGE is the edge only (the
      // embedded engine rejects label re-declarations on bound variables)
      expect(query).toContain('MERGE (from)-[rel:WROTE]->(to)')
      expect(query).toContain('ON CREATE SET rel = coalesce(row.properties, {})')
      expect(query).toContain('ON MATCH SET rel += coalesce(row.properties, {})')
      expect(query).toContain('RETURN count(rel) AS related')
    })

    it('renders an INCOMING declaration with the reversed MERGE pattern', () => {
      const query = buildRelateQuery(
        ['BulkPost'],
        ['BulkPerson'],
        'WROTE',
        Direction.INCOMING,
        'id',
        'id',
      )

      expect(query).toContain('MERGE (from)<-[rel:WROTE]-(to)')
    })

    it('escapes hostile labels and types', () => {
      const query = buildRelateQuery(
        ['Post` DETACH DELETE x'],
        ['Person'],
        'W` ROTE',
        Direction.OUTGOING,
        'id',
        'id',
      )

      expect(query).toContain('MATCH (from:`Post`` DETACH DELETE x` {')
      expect(query).toContain('[rel:`W`` ROTE`]')
    })

    it('rejects an undirected (BOTH) declaration', () => {
      expect(() =>
        buildRelateQuery(['BulkPost'], ['BulkPerson'], 'WROTE', Direction.BOTH, 'id', 'id'),
      ).toThrow(NeodeError)
    })
  })

  describe('relateMany validation (before any statement runs)', () => {
    const bulk = new BulkService({
      run: async () => ({ records: [], summary: undefined }),
    } as never)

    it('rejects a relationship key the model does not declare', async () => {
      await expect(
        bulk.relateMany(getModel(BulkPost)!, 'notDeclared', [{ from: 'p1', to: 'p1' }]),
      ).rejects.toThrow(NeodeError)
    })

    it('rejects restricted cardinalities (one / zeroOrOne)', async () => {
      await expect(
        bulk.relateMany(getModel(BulkOneAuthor)!, 'author', [{ from: 'p1', to: 'p1' }]),
      ).rejects.toThrow(/only supports "many" relationships/)
    })

    it('rejects edge-entity (relationship entity) targets', async () => {
      await expect(
        bulk.relateMany(getModel(BulkEdgeOwner)!, 'ownership', [{ from: 'p1', to: 'p1' }]),
      ).rejects.toThrow(/edge entities/)
    })

    it('resolves the fallback primary key for a model without an explicit @Primary', async () => {
      await expect(
        bulk.relateMany(getModel(BulkNoPk)!, 'knows', [{ from: 'a', to: 'b' }]),
      ).resolves.toEqual({ related: 0, chunks: 1 })
    })

    it('converts edge properties through the shared pipeline', () => {
      // A plain relationship accepts literal edge properties untouched
      const relationship = getModel(BulkPost)!.getRelationship('author')
      expect(convertEdgeProperties(relationship, { weight: 2 })).toEqual({ weight: 2 })
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

  describe('rowToProperties (NTS-625)', () => {
    it('maps a row through the create pipeline, converting values', async () => {
      const result = await rowToProperties(getModel(BulkPerson), {
        id: FIXED_UUID,
        name: 'Adam',
        age: '30',
      })

      expect(result.ok).toBe(true)

      if (result.ok) {
        expect(result.properties.id).toBe(FIXED_UUID)
        expect(result.properties.name).toBe('Adam')
        expect(result.properties.age).toBe(30)
      }
    })

    it('resolves defaults and fakes for unset properties', async () => {
      const result = await rowToProperties(getModel(BulkBadge), { slug: 'slug-manual' })

      expect(result.ok).toBe(true)

      if (result.ok) {
        expect(result.properties.slug).toBe('slug-manual')
        expect(result.properties.code).toMatch(/^code-\d+$/) // fake generator ran
      }
    })

    it('applies the header rename map before the pipeline', async () => {
      const result = await rowToProperties(
        getModel(BulkPerson),
        { uuid: FIXED_UUID, person_name: 'Adam', age: 30 },
        { map: { uuid: 'id', person_name: 'name' } },
      )

      expect(result.ok).toBe(true)

      if (result.ok) {
        expect(result.properties.id).toBe(FIXED_UUID)
        expect(result.properties.name).toBe('Adam')
      }
    })

    it('collects every failing check as { ok: false } instead of throwing', async () => {
      const result = await rowToProperties(getModel(BulkPerson), { id: 'not-a-uuid', name: 'A' })

      expect(result.ok).toBe(false)

      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThanOrEqual(2)

        for (const detail of result.errors) {
          expect(detail.message).toBeTruthy()
          expect(detail.type).toBeTruthy()
        }
      }
    })

    it('reports nested relationship rows as a single error', async () => {
      const result = await rowToProperties(getModel(BulkPost), {
        id: FIXED_UUID,
        title: 'T',
        author: 1,
      })

      expect(result.ok).toBe(false)

      if (!result.ok) {
        expect(result.errors).toHaveLength(1)
        expect(result.errors[0]?.message).toContain('nested relationship values')
      }
    })

    it('coerces boolean strings and passes unparseable forms to validation (NTS-639)', async () => {
      const schema = getModel(BulkFlagged)

      const coerced = await rowToProperties(schema, { id: FIXED_UUID, active: ' TRUE ' })

      expect(coerced.ok).toBe(true)

      if (coerced.ok) {
        expect(coerced.properties.active).toBe(true)
      }

      const rejected = await rowToProperties(schema, { id: FIXED_UUID, active: 'yes' })

      expect(rejected.ok).toBe(false)
    })
  })
})
