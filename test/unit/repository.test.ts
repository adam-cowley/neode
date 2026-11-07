import { vi } from 'vitest'
import { Repository } from '../../src/repository'
import type { INeode } from '../../src/neode.interface'
import { GraphNode, QueryOutput, QueryRecord } from '../../src/driver/types'
import {
  NodeEntity,
  InternalId,
  Uuid,
  String,
  Number as NumberProperty,
} from '../../src/decorators'
import { fulltextIndexName } from '../../src/services/schema/fulltext.service'

// ---- Fixtures (decorator registry is global per module registry) -----------

@NodeEntity()
class Movie {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  title: string

  @NumberProperty()
  released: number

  static build(values: Record<string, unknown>): Movie {
    return Object.assign(new Movie(), values) as unknown as Movie
  }
}

// ---- INeode stub ------------------------------------------------------------

function record(value: unknown): QueryRecord {
  return { get: (_key: string) => value, has: () => true, keys: ['this'] }
}

function node(values: Record<string, unknown>): GraphNode {
  return { elementId: '4:abc:1', labels: ['Movie'], properties: values }
}

function keyedRecord(values: Record<string, unknown>): QueryRecord {
  return { get: (key: string) => values[key], has: () => true, keys: Object.keys(values) }
}

function stubNeode(output: Partial<QueryOutput> = {}) {
  const mocks = {
    find: vi.fn<(constructor: unknown, value: string, database?: string) => Promise<unknown>>(),
    findById:
      vi.fn<(constructor: unknown, elementId: string, database?: string) => Promise<unknown>>(),
    save: vi.fn<(entity: unknown, database?: string) => Promise<unknown>>(),
    delete: vi.fn<(entity: unknown, database?: string) => Promise<void>>(),
    readCypher:
      vi.fn<
        (query: string, params: Record<string, unknown>, database?: string) => Promise<QueryOutput>
      >(),
    writeCypher:
      vi.fn<
        (query: string, params: Record<string, unknown>, database?: string) => Promise<QueryOutput>
      >(),
    search:
      vi.fn<
        (
          constructor: unknown,
          indexName: string,
          query: string,
          limit?: number,
        ) => Promise<unknown[]>
      >(),
  }

  mocks.find.mockResolvedValue(undefined)
  mocks.findById.mockResolvedValue(undefined)
  mocks.save.mockImplementation(async (entity: unknown) => entity)
  mocks.delete.mockResolvedValue(undefined)
  mocks.readCypher.mockResolvedValue({ records: [], ...output })
  mocks.writeCypher.mockResolvedValue({ records: [], ...output })
  mocks.search.mockResolvedValue([])

  return { neode: mocks as unknown as INeode, mocks }
}

// -----------------------------------------------------------------------------

describe('Repository', () => {
  describe('schema', () => {
    it('reads the primary key from the entity schema', () => {
      const { neode } = stubNeode()
      const repo = new Repository<Movie>(neode, Movie)

      expect(repo.getPrimaryKey().getKey()).toBe('id')
    })
  })

  describe('find', () => {
    it('delegates to neode.find with the constructor and id', async () => {
      const { neode, mocks } = stubNeode()
      mocks.find.mockResolvedValue(Movie.build({ title: 'Alien' }))

      const repo = new Repository<Movie>(neode, Movie)
      const found = await repo.find('abc-123')

      expect(mocks.find.mock.calls[0][0]).toBe(Movie)
      expect(mocks.find.mock.calls[0][1]).toBe('abc-123')
      expect(found?.title).toBe('Alien')
    })
  })

  describe('findBy', () => {
    it('returns the first match for the given properties', async () => {
      const { neode, mocks } = stubNeode({
        records: [record(node({ id: 'u1', title: 'Alien', released: 1979 }))],
      })

      const repo = new Repository<Movie>(neode, Movie)
      const found = await repo.findBy({ title: 'Alien' })

      expect(found?.title).toBe('Alien')
      expect(found).toBeInstanceOf(Movie)

      const [query, params] = mocks.readCypher.mock.calls[0]

      expect(query).toContain('MATCH (this:Movie)')
      expect(query).toContain('WHERE (this.title = $')
      expect(query).toContain('LIMIT 1')
      expect(Object.values(params)).toContain('Alien')
    })
  })

  describe('findAll', () => {
    it('matches every node of the label when called without params', async () => {
      const { neode, mocks } = stubNeode()

      const repo = new Repository<Movie>(neode, Movie)
      await repo.findAll()

      const query = mocks.readCypher.mock.calls[0][0]

      expect(query).toContain('MATCH (this:Movie)')
      expect(query).not.toContain('WHERE')
      expect(query).toContain('RETURN this')
    })

    it('filters on declared schema properties', async () => {
      const { neode, mocks } = stubNeode()

      const repo = new Repository<Movie>(neode, Movie)
      await repo.findAll({ released: 1979 })

      const [query, params] = mocks.readCypher.mock.calls[0]

      expect(query).toContain('WHERE (this.released = $')
      expect(Object.values(params)).toContain(1979)
    })

    it('applies order, limit and skip', async () => {
      const { neode, mocks } = stubNeode()

      const repo = new Repository<Movie>(neode, Movie)
      await repo.findAll({ released: 1979 }, { order: { released: 'DESC' }, limit: 2, skip: 4 })

      const query = mocks.readCypher.mock.calls[0][0]

      expect(query).toContain('ORDER BY this.released DESC')
      expect(query).toContain('SKIP 4')
      expect(query).toContain('LIMIT 2')
    })

    it('supports the array and { field, order } ordering forms', async () => {
      const { neode, mocks } = stubNeode()

      const repo = new Repository<Movie>(neode, Movie)
      await repo.findAll({}, { order: ['title', { field: 'released', order: 'DESC' }] })

      const query = mocks.readCypher.mock.calls[0][0]

      expect(query).toContain('ORDER BY this.title')
      expect(query).toContain('this.released DESC')
    })

    it('hydrates returned nodes into entities', async () => {
      const { neode } = stubNeode({
        records: [
          record(node({ id: 'u1', title: 'Alien', released: 1979 })),
          record(node({ id: 'u2', title: 'Aliens', released: 1986 })),
        ],
      })

      const repo = new Repository<Movie>(neode, Movie)
      const results = await repo.findAll()

      expect(results).toHaveLength(2)
      expect(results[0]).toBeInstanceOf(Movie)
      expect(results[1]?.title).toBe('Aliens')
    })
  })

  describe('where', () => {
    it('is a functional alias of findAll with params', async () => {
      const { neode, mocks } = stubNeode({
        records: [record(node({ id: 'u1', title: 'Alien', released: 1979 }))],
      })

      const repo = new Repository<Movie>(neode, Movie)
      const results = await repo.where({ title: 'Alien' })

      expect(results).toHaveLength(1)
      expect(results[0]?.title).toBe('Alien')

      const query = mocks.readCypher.mock.calls[0][0]

      expect(query).toContain('WHERE (this.title = $')
    })
  })

  describe('count', () => {
    it('returns the number of matching nodes', async () => {
      const { neode, mocks } = stubNeode({ records: [record(3)] })

      const repo = new Repository<Movie>(neode, Movie)
      const total = await repo.count({ released: 1979 })

      expect(total).toBe(3)

      const [query, params] = mocks.readCypher.mock.calls[0]

      expect(query).toContain('MATCH (this:Movie)')
      expect(query).toContain('WHERE (this.released = $')
      expect(query).toContain('RETURN count(this) AS count')
      expect(Object.values(params)).toContain(1979)
    })

    it('coerces driver Integer values', async () => {
      const { neode } = stubNeode({ records: [record({ toNumber: () => 7 })] })

      const repo = new Repository<Movie>(neode, Movie)

      expect(await repo.count()).toBe(7)
    })
  })

  describe('save', () => {
    it('delegates to neode.save', async () => {
      const { neode, mocks } = stubNeode()

      const repo = new Repository<Movie>(neode, Movie)
      const entity = Movie.build({ title: 'Alien' })
      const saved = await repo.save(entity)

      expect(mocks.save.mock.calls[0][0]).toBe(entity)
      expect(saved).toBe(entity)
    })
  })

  describe('saveAll', () => {
    it('saves every entity', async () => {
      const { neode, mocks } = stubNeode()

      const repo = new Repository<Movie>(neode, Movie)
      const entities = [Movie.build({ title: 'Alien' }), Movie.build({ title: 'Aliens' })]
      const saved = await repo.saveAll(entities)

      expect(mocks.save).toHaveBeenCalledTimes(2)
      expect(saved).toEqual(entities)
    })
  })

  describe('patch', () => {
    it('applies the patch to the entity and persists it via save', async () => {
      const { neode, mocks } = stubNeode()

      const repo = new Repository<Movie>(neode, Movie)
      const entity = Movie.build({ id: 'u1', title: 'Alien', released: 1979 })

      const updated = await repo.patch(entity, { released: 2003 })

      expect(updated).toBe(entity)
      expect(updated.released).toBe(2003)
      expect(mocks.save.mock.calls[0][0]).toBe(entity)
    })
  })

  describe('delete', () => {
    it('deletes an entity instance directly', async () => {
      const { neode, mocks } = stubNeode()

      const repo = new Repository<Movie>(neode, Movie)
      const entity = Movie.build({ id: 'u1', title: 'Alien' })

      await repo.delete(entity)

      expect(mocks.find).not.toHaveBeenCalled()
      expect(mocks.delete.mock.calls[0][0]).toBe(entity)
    })

    it('resolves a primary key value to the entity, then deletes it', async () => {
      const { neode, mocks } = stubNeode()
      const entity = Movie.build({ id: 'u1', title: 'Alien' })
      mocks.find.mockResolvedValue(entity)

      const repo = new Repository<Movie>(neode, Movie)

      await repo.delete('u1')

      expect(mocks.find).toHaveBeenCalledWith(Movie, 'u1', undefined)
      expect(mocks.delete.mock.calls[0][0]).toBe(entity)
    })

    it('throws when no entity exists for the primary key value', async () => {
      const { neode } = stubNeode()

      const repo = new Repository<Movie>(neode, Movie)

      await expect(repo.delete('nope')).rejects.toThrow(/not found/i)
    })

    it('silently no-ops when ifExists is set and the entity is missing', async () => {
      const { neode, mocks } = stubNeode()

      const repo = new Repository<Movie>(neode, Movie)

      await expect(repo.delete('nope', { ifExists: true })).resolves.toBeUndefined()
      expect(mocks.delete).not.toHaveBeenCalled()
    })
  })

  describe('deleteAll', () => {
    it('bulk deletes matching nodes and reports the count', async () => {
      const { neode, mocks } = stubNeode({ records: [record(2)] })

      const repo = new Repository<Movie>(neode, Movie)
      const deleted = await repo.deleteAll({ released: 1979 })

      expect(deleted).toBe(2)

      const [query, params] = mocks.writeCypher.mock.calls[0]

      expect(query).toContain('MATCH (this:Movie)')
      expect(query).toContain('WHERE (this.released = $')
      expect(query).toContain('DETACH DELETE this')
      expect(query).toContain('RETURN count(this) AS count')
      expect(Object.values(params)).toContain(1979)
    })

    it('clears every node of the label when called without params', async () => {
      const { neode, mocks } = stubNeode({ records: [record(0)] })

      const repo = new Repository<Movie>(neode, Movie)
      await repo.deleteAll()

      const query = mocks.writeCypher.mock.calls[0][0]

      expect(query).not.toContain('WHERE')
      expect(query).toContain('DETACH DELETE this')
    })
  })

  describe('typing', () => {
    it('types every call against the entity constructor', async () => {
      const { neode, mocks } = stubNeode({
        records: [
          keyedRecord({
            this: node({ id: 'u1', title: 'Alien', released: 1979 }),
            count: 2,
          }),
        ],
      })
      mocks.find.mockResolvedValue(Movie.build({ id: 'u1', title: 'Alien', released: 1979 }))
      const repo = new Repository<Movie>(neode, Movie)

      const one: Movie | undefined = await repo.find('u1')
      const first: Movie | undefined = await repo.findBy({ title: 'Alien' })
      const all: Movie[] = await repo.findAll(
        { released: 1979 },
        { order: 'released', limit: 1, skip: 0 },
      )
      const filtered: Movie[] = await repo.where({ title: 'Alien' })
      const total: number = await repo.count({ released: 1979 })
      const saved: Movie = await repo.save(Movie.build({ title: 'Alien' }))
      const many: Movie[] = await repo.saveAll([Movie.build({ title: 'Alien' })])
      const updated: Movie = await repo.patch(Movie.build({ title: 'Alien' }), { released: 1979 })
      const gone: void = await repo.delete('u1')
      const bulk: number = await repo.deleteAll({ released: 1979 })

      expect([one, first, all, filtered, total, saved, many, updated, gone, bulk]).toBeDefined()
    })

    it('rejects unknown properties in typed calls', async () => {
      const { neode } = stubNeode()
      const repo = new Repository<Movie>(neode, Movie)

      // @ts-expect-error "bogus" is not a property of Movie
      await repo.findBy({ bogus: true })
    })
  })

  describe('increment', () => {
    it('writes one atomic coalesce statement and returns the new value', async () => {
      const { neode, mocks } = stubNeode({ records: [keyedRecord({ value: 5 })] })

      const repo = new Repository<Movie>(neode, Movie)
      const value = await repo.increment('u1', 'released', 2)

      const [query] = mocks.writeCypher.mock.calls[0]

      expect(query).toContain('MATCH (this:Movie { id: $this_id })')
      expect(query).toContain('SET this.`released` = coalesce(this.`released`, 0) + (2)')
      expect(query).toContain('RETURN this.`released` AS value')
      expect(value).toBe(5)
    })

    it('accepts an entity instance and matches on its primary key', async () => {
      const { neode, mocks } = stubNeode({ records: [keyedRecord({ value: 1 })] })

      const repo = new Repository<Movie>(neode, Movie)
      await repo.increment(Movie.build({ id: 'u1' }), 'released')

      const [query, params] = mocks.writeCypher.mock.calls[0]

      expect(query).toContain('MATCH (this:Movie { id: $')
      expect(Object.values(params)).toContain('u1')
    })

    it('rejects undeclared properties', async () => {
      const { neode } = stubNeode()
      const repo = new Repository<Movie>(neode, Movie)

      // @ts-expect-error "bogus" is not a property of Movie
      await expect(repo.increment('u1', 'bogus')).rejects.toThrow('not a declared property')
    })

    it('rejects non-finite steps', async () => {
      const { neode } = stubNeode()
      const repo = new Repository<Movie>(neode, Movie)

      await expect(repo.increment('u1', 'released', Number.NaN)).rejects.toThrow('finite number')
      await expect(repo.increment('u1', 'released', Number.POSITIVE_INFINITY)).rejects.toThrow(
        'finite number',
      )
    })

    it('returns 0 instead of throwing when ifExists is set and the entity is missing', async () => {
      const { neode } = stubNeode()

      const repo = new Repository<Movie>(neode, Movie)
      const value = await repo.increment('missing', 'released', 1, { ifExists: true })

      expect(value).toBe(0)
    })
  })

  describe('countBy', () => {
    it('groups counts by the declared property', async () => {
      const { neode, mocks } = stubNeode({
        records: [
          keyedRecord({ value: 'ACTIVE', count: 3 }),
          keyedRecord({ value: 'CLOSED', count: 1 }),
        ],
      })

      const repo = new Repository<Movie>(neode, Movie)
      const counts = await repo.countBy('released', { title: 'Alien' })

      const [query] = mocks.readCypher.mock.calls[0]

      expect(query).toContain('RETURN this.`released` AS value, count(this) AS count')
      expect(counts).toEqual({ ACTIVE: 3, CLOSED: 1 })
    })

    it('rejects undeclared properties', async () => {
      const { neode } = stubNeode()
      const repo = new Repository<Movie>(neode, Movie)

      // @ts-expect-error "bogus" is not a property of Movie
      await expect(repo.countBy('bogus')).rejects.toThrow('not a declared property')
    })
  })

  describe('search', () => {
    @NodeEntity()
    class Searchable {
      @InternalId()
      _id: string

      @Uuid({ primary: true })
      id: string

      @String()
      title: string

      @String({ fulltext: true })
      plot: string

      static build(values: Record<string, unknown>): Searchable {
        return Object.assign(new Searchable(), values) as unknown as Searchable
      }
    }

    it('resolves the index name from the declared fulltext properties', async () => {
      const { neode, mocks } = stubNeode()
      const repo = new Repository<Searchable>(neode, Searchable)

      await repo.search('alien')

      const [constructor, indexName, query, limit] = mocks.search.mock.calls[0]

      expect(constructor).toBe(Searchable)
      expect(indexName).toBe(fulltextIndexName({ label: 'Searchable', properties: ['plot'] }))
      expect(query).toBe('alien')
      expect(limit).toBeUndefined()
    })

    it('passes the limit through', async () => {
      const { neode, mocks } = stubNeode()
      const repo = new Repository<Searchable>(neode, Searchable)

      await repo.search('alien', { limit: 5 })

      expect(mocks.search.mock.calls[0][3]).toBe(5)
    })

    it('throws when the model declares no fulltext properties', async () => {
      const { neode } = stubNeode()
      const repo = new Repository<Movie>(neode, Movie)

      await expect(repo.search('alien')).rejects.toThrow('fulltext: true')
    })
  })
})
