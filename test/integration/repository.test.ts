import { Repository } from '../../src/repository'
import { NodeEntity, InternalId, Uuid, String, Number } from '../../src/decorators'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Movie {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  title: string

  @Number()
  released: number

  static create(title: string, released: number): Movie {
    const movie = new Movie()
    movie.title = title
    movie.released = released

    return movie
  }
}

// ---------------------------------------------------------------------------

describe('Repository', () => {
  let backend: TestBackend
  let movies: Repository<Movie>

  beforeAll(async () => {
    backend = await openBackend()
    movies = backend.neode.getRepository(Movie)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('is a typed repository for the entity constructor', () => {
    expect(movies).toBeInstanceOf(Repository)
    expect(movies.getPrimaryKey().getKey()).toBe('id')
  })

  describe('full CRUD', () => {
    it('saves, finds, updates and deletes an entity', async () => {
      const saved = await movies.save(Movie.create('Alien', 1979))

      expect(saved).toBeInstanceOf(Movie)
      expect(saved.id).toBeDefined()

      const found = await movies.find(saved.id)

      expect(found?.title).toBe('Alien')

      const updated = await movies.patch(found as Movie, { released: 2003 })

      expect(updated.released).toBe(2003)

      const refound = await movies.find(saved.id)

      expect(refound?.released).toBe(2003)
      expect(refound?.title).toBe('Alien')

      await movies.delete(saved.id)

      expect(await movies.find(saved.id)).toBeUndefined()
    })

    it('deletes an entity instance directly', async () => {
      const saved = await movies.save(Movie.create('Alien', 1979))

      await movies.delete(saved)

      expect(await movies.count()).toBe(0)
    })

    it('throws when deleting a primary key that does not exist', async () => {
      await expect(movies.delete('no-such-id')).rejects.toThrow(/not found/i)
    })
  })

  describe('saveAll', () => {
    it('persists every entity', async () => {
      const saved = await movies.saveAll([
        Movie.create('Alien', 1979),
        Movie.create('Aliens', 1986),
      ])

      expect(saved).toHaveLength(2)
      expect(await movies.count()).toBe(2)
    })
  })

  describe('findBy', () => {
    it('returns the first match for the given properties', async () => {
      await movies.save(Movie.create('Alien', 1979))
      await movies.save(Movie.create('Aliens', 1986))

      const found = await movies.findBy({ released: 1986 })

      expect(found?.title).toBe('Aliens')
    })

    it('returns undefined when nothing matches', async () => {
      expect(await movies.findBy({ title: 'Nobody' })).toBeUndefined()
    })
  })

  describe('findAll ordering and pagination', () => {
    beforeEach(async () => {
      await movies.save(Movie.create('Alien³', 1992))
      await movies.save(Movie.create('Alien', 1979))
      await movies.save(Movie.create('Aliens', 1986))
    })

    it('orders ascending by a property', async () => {
      const results = await movies.findAll({}, { order: 'released' })

      expect(results.map((movie) => movie.released)).toEqual([1979, 1986, 1992])
    })

    it('orders descending via a direction map', async () => {
      const results = await movies.findAll({}, { order: { released: 'DESC' } })

      expect(results.map((movie) => movie.released)).toEqual([1992, 1986, 1979])
    })

    it('paginates with skip and limit', async () => {
      const page = await movies.findAll({}, { order: 'released', skip: 1, limit: 1 })

      expect(page.map((movie) => movie.title)).toEqual(['Aliens'])
    })

    it('filters by properties', async () => {
      const results = await movies.findAll({ released: 1979 })

      expect(results).toHaveLength(1)
      expect(results[0]?.title).toBe('Alien')
    })
  })

  describe('where', () => {
    it('filters functionally', async () => {
      await movies.save(Movie.create('Alien', 1979))
      await movies.save(Movie.create('Aliens', 1986))

      const results = await movies.where({ released: 1986 })

      expect(results).toHaveLength(1)
      expect(results[0]?.title).toBe('Aliens')
    })
  })

  describe('count', () => {
    it('counts all and filtered matches', async () => {
      await movies.save(Movie.create('Alien', 1979))
      await movies.save(Movie.create('Aliens', 1986))
      await movies.save(Movie.create('Alien³', 1992))

      expect(await movies.count()).toBe(3)
      expect(await movies.count({ released: 1986 })).toBe(1)
      expect(await movies.count({ released: 2000 })).toBe(0)
    })
  })

  describe('deleteAll', () => {
    it('bulk deletes only the matching entities', async () => {
      await movies.save(Movie.create('Alien', 1979))
      await movies.save(Movie.create('Aliens', 1986))
      await movies.save(Movie.create('Alien Resurrection', 1997))

      const deleted = await movies.deleteAll({ released: 1997 })

      expect(deleted).toBe(1)
      expect(await movies.count()).toBe(2)
      expect(await movies.count({ released: 1997 })).toBe(0)
    })

    it('deletes everything when confirmed with { all: true }', async () => {
      await movies.save(Movie.create('Alien', 1979))
      await movies.save(Movie.create('Aliens', 1986))

      // An unfiltered deleteAll is refused (NTS-595 destructive guard)
      await expect(movies.deleteAll()).rejects.toThrow(/deleteAll\(\) refused/)

      const deleted = await movies.deleteAll({ all: true })

      expect(deleted).toBe(2)
      expect(await movies.count()).toBe(0)
    })
  })

  describe('upsert', () => {
    it('creates the node when the merge fields match nothing', async () => {
      const created = await movies.upsert({ title: 'Alien', released: 1979 })

      expect(created).toBeInstanceOf(Movie)
      expect(await movies.count({ title: 'Alien' })).toBe(1)
    })

    it('updates the same node instead of duplicating when the merge fields match', async () => {
      await movies.upsert({ title: 'Alien', released: 1979 })
      const updated = await movies.upsert({ title: 'Alien', released: 2003 })

      expect(await movies.count({ title: 'Alien' })).toBe(1)
      expect(updated?.released).toBe(2003)
    })

    it('merges inside an open write transaction', async () => {
      const tx = await backend.neode.openWriteTransaction()

      try {
        const merged = (await tx.merge(Movie, { title: 'Tx Alien', released: 1979 }))?.entity

        expect(merged).toBeInstanceOf(Movie)
      } finally {
        await tx.commit()
      }

      expect(await movies.count({ title: 'Tx Alien' })).toBe(1)
    })
  })
})
