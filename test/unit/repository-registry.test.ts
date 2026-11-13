import { vi } from 'vitest'
import { Repository } from '../../src/repository'
import {
  NodeEntity,
  InternalId,
  Uuid,
  Property,
  Number,
  EntityRepository,
} from '../../src/decorators'
import { registerRepository, getRepository, resolveRepository } from '../../src/meta/repositories'
import type { INeode } from '../../src/neode.interface'
import { GraphNode, QueryOutput, QueryRecord } from '../../src/driver/types'

// ---- Fixtures (decorator registry is global per module registry) -----------

@NodeEntity()
class Person {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string

  @Number()
  age: number
}

@EntityRepository(Person)
class PeopleRepository extends Repository<Person> {
  adults(): Promise<Person[]> {
    return this.findAll()
  }
}

@NodeEntity()
class Movie {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  title: string
}

// ---- INeode stub ------------------------------------------------------------

function record(value: unknown): QueryRecord {
  return { get: (_key: string) => value, has: () => true, keys: ['this'] }
}

function node(values: Record<string, unknown>): GraphNode {
  return { elementId: '4:abc:1', labels: ['Person'], properties: values }
}

function stubNeode(output: Partial<QueryOutput> = {}) {
  const mocks = {
    find: vi.fn<() => Promise<unknown>>(),
    save: vi.fn<() => Promise<unknown>>(),
    delete: vi.fn<() => Promise<void>>(),
    readCypher:
      vi.fn<
        (query: string, params: Record<string, unknown>, database?: string) => Promise<QueryOutput>
      >(),
    writeCypher: vi.fn<() => Promise<QueryOutput>>(),
  }

  mocks.readCypher.mockResolvedValue({
    records: [record(node({ id: 'u1', name: 'Alice', age: 30 }))],
    ...output,
  })
  mocks.writeCypher.mockResolvedValue({ records: [], ...output })

  return { neode: mocks as unknown as INeode, mocks }
}

// -----------------------------------------------------------------------------

describe('repository registry', () => {
  describe('registerRepository / getRepository', () => {
    it('stores the repository constructor for the entity', () => {
      registerRepository(Movie, PeopleRepository)

      expect(getRepository(Movie)).toBe(PeopleRepository)
    })

    it('accepts a repository instance and stores its constructor', () => {
      const { neode } = stubNeode()

      registerRepository(Movie, new Repository<Movie>(neode, Movie))

      expect(getRepository(Movie)).toBe(Repository)
    })
  })

  describe('resolveRepository', () => {
    it('returns an instance of the registered custom repository', () => {
      const { neode } = stubNeode()

      const repo = resolveRepository(neode, Person)

      expect(repo).toBeInstanceOf(PeopleRepository)
      expect(repo).toBeInstanceOf(Repository)
    })

    it('constructs the custom repository with the neode instance and entity', async () => {
      const { neode, mocks } = stubNeode()

      const repo = resolveRepository(neode, Person) as PeopleRepository
      await repo.adults()

      expect(mocks.readCypher).toHaveBeenCalledTimes(1)

      const [query] = mocks.readCypher.mock.calls[0]

      expect(query).toContain('MATCH (this:Person)')
    })

    it('resolves per entity: other entities keep their own repositories', () => {
      const { neode } = stubNeode()

      expect(resolveRepository(neode, Person)).toBeInstanceOf(PeopleRepository)
      expect(resolveRepository(neode, Movie)).not.toBeInstanceOf(PeopleRepository)
    })

    it('falls back to the default Repository when none is registered', () => {
      const { neode } = stubNeode()

      const repo = resolveRepository(neode, Movie)

      expect(repo).toBeInstanceOf(Repository)
      expect(repo).not.toBeInstanceOf(PeopleRepository)
      expect(repo.getPrimaryKey().getKey()).toBe('id')
    })
  })

  describe('@EntityRepository decorator', () => {
    it('registers the decorated class for resolution', () => {
      const { neode } = stubNeode()

      expect(resolveRepository(neode, Person)).toBeInstanceOf(PeopleRepository)
    })

    it('errors when applied without an entity link', () => {
      // @ts-expect-error the entity link is required
      expect(() => EntityRepository()).toThrow(/entity/i)
    })
  })
})
