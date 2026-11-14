import { openBackend, TestBackend } from './support/backend'
import { setDefaultNeode } from '../../src/entity-methods'
import type { WithMethods } from '../../src/entity-methods'
import {
  Filter,
  InternalId,
  NodeEntity,
  OneToMany,
  OneToOne,
  Property,
  Uuid,
} from '../../src/decorators'
import { Direction } from '../../src/query'
import { EventType } from '../../src/common/events'
import type { QueryExecutedEvent } from '../../src/common/events'
import { clearFilterParams, setFilterParams } from '../../src/index'

// ---- Fixtures (per-file: decorator registry is global per module) -----------

// The TARGET model carries the global filter (NTS-162): the traversal read
// behind related() must apply it inside the match
@NodeEntity()
@Filter({ name: 'tenant', where: 'node.tenant = $tenant' })
class Movie {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  title: string

  @Property({ type: 'number' })
  year: number

  @Property({ type: 'string' })
  tenant: string
}

@NodeEntity()
class Person {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string

  @OneToMany(() => Movie, 'ACTED_IN', Direction.OUTGOING)
  actedIn: Movie[]

  @OneToOne({ type: 'FAVORITE', target: () => Movie, direction: Direction.OUTGOING })
  favorite: Movie | undefined
}

// ---------------------------------------------------------------------------

/** A saved person whose actedIn edges carry one role per movie, freshly re-found */
async function seededRoles(
  neode: TestBackend['neode'],
  roles: string[],
): Promise<WithMethods<Person>> {
  const person = new Person()
  person.name = `person-${Math.random()}`

  const savedPerson = (await neode.save(person)) as WithMethods<Person>

  for (const [index, role] of roles.entries()) {
    const movie = new Movie()
    movie.title = `Role ${index}-${Math.random()}`
    movie.year = 1999 + index
    movie.tenant = 'acme'

    const savedMovie = (await neode.save(movie)) as WithMethods<Movie>

    await savedPerson.relateTo(savedMovie, 'actedIn', { role })
  }

  return (await neode.find(Person, savedPerson.id)) as WithMethods<Person>
}

describe('instance.related(key) — relationship query builder (NTS-497)', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()

    setDefaultNeode(backend.neode)
  })

  afterEach(async () => {
    clearFilterParams()

    await backend.clearGraph()
  })

  beforeEach(async () => {
    // Movie carries the 'tenant' filter on every read — bind its param
    // for all tests (the filter test overrides it)
    setFilterParams('tenant', 'acme')
  })

  afterAll(async () => {
    await backend.close()
  })

  /** A saved person with one related movie per year, freshly re-found */
  async function seededPerson(years: number[], tenant = 'acme'): Promise<WithMethods<Person>> {
    const person = new Person()
    person.name = `person-${Math.random()}`

    const savedPerson = (await backend.neode.save(person)) as WithMethods<Person>

    for (const [index, year] of years.entries()) {
      const movie = new Movie()
      movie.title = `Movie ${index}-${Math.random()}`
      movie.year = year
      movie.tenant = tenant

      const savedMovie = (await backend.neode.save(movie)) as WithMethods<Movie>

      await savedPerson.relateTo(savedMovie, 'actedIn')
    }

    return (await backend.neode.find(Person, savedPerson.id)) as WithMethods<Person>
  }

  /** A saved favourite movie related through the one-key */
  async function seedFavorite(person: WithMethods<Person>, year: number): Promise<void> {
    const movie = new Movie()
    movie.title = `Favorite-${Math.random()}`
    movie.year = year
    movie.tenant = 'acme'

    const savedMovie = (await backend.neode.save(movie)) as WithMethods<Movie>

    await person.relateTo(savedMovie, 'favorite')
  }

  it('chains where over a many-key and returns hydrated related entities', async () => {
    const person = await seededPerson([1999, 2003, 1999, 2013])

    const movies = await person.related('actedIn').where({ year: 1999 }).find()

    expect(movies).toHaveLength(2)

    for (const movie of movies) {
      expect(movie).toBeInstanceOf(Movie)
      expect(movie.year).toBe(1999)
    }
  })

  it('composes order/limit/skip on top of the traversal', async () => {
    const person = await seededPerson([2003, 1999, 2013])

    const page = await person.related('actedIn').orderBy('year').skip(1).limit(2).find()

    expect(page.map((movie) => movie.year)).toEqual([2003, 2013])

    // The explicit-operator where form prefixes the bare property too
    const modern = await person.related('actedIn').where('year', '>', 2000).find()

    expect(modern.map((movie) => movie.year).sort()).toEqual([2003, 2013])
  })

  it('first() resolves one hydrated entity, or undefined when empty', async () => {
    const person = await seededPerson([2013, 1999])

    const first = await person.related('actedIn').orderBy('year').first()

    expect(first).toBeInstanceOf(Movie)
    expect(first?.year).toBe(1999)

    const empty = await seededPerson([])

    await expect(empty.related('actedIn').first()).resolves.toBeUndefined()
  })

  it('resolves a @RelatedOne key: find() gives the entity or undefined', async () => {
    const person = await seededPerson([1999])

    await seedFavorite(person, 2000)

    const reFound = (await backend.neode.find(Person, person.id)) as WithMethods<Person>

    const favorite = await reFound.related('favorite').find()

    expect(favorite).toBeInstanceOf(Movie)

    // A person with no favourite: find() resolves undefined, no error
    const empty = await seededPerson([])

    await expect(empty.related('favorite').find()).resolves.toBeUndefined()
  })

  it('count() counts the matching related nodes', async () => {
    const person = await seededPerson([1999, 1999, 2003])

    await expect(person.related('actedIn').count()).resolves.toBe(3)
    await expect(person.related('actedIn').where({ year: 1999 }).count()).resolves.toBe(2)
  })

  it('applies the target model global filters inside the traversal — filtered-out targets yield empty results, no error', async () => {
    setFilterParams('tenant', 'other-tenant')

    const person = await seededPerson([1999])

    await expect(person.related('actedIn').find()).resolves.toEqual([])
    await expect(person.related('actedIn').first()).resolves.toBeUndefined()
    await expect(person.related('actedIn').count()).resolves.toBe(0)

    // The matching tenant reads the movies back through the same scope
    setFilterParams('tenant', 'acme')

    await expect(person.related('actedIn').find()).resolves.toHaveLength(1)
  })

  it('rejects keys that are not declared relationships', async () => {
    const person = await seededPerson([])

    expect(() => person.related('name')).toThrow('Unknown relationship "name"')
  })

  it('rejects reading off an instance that was never persisted', async () => {
    const person = new Person()
    person.name = 'unsaved'

    const withMethods = person as WithMethods<Person>

    await expect(withMethods.related('actedIn').find()).rejects.toThrow('no elementId')
  })
})

describe('relationship-aware instance reads (NTS-499)', () => {
  let backend: TestBackend

  let executed: QueryExecutedEvent[]

  const onQuery = (event: QueryExecutedEvent): void => {
    executed.push(event)
  }

  beforeAll(async () => {
    backend = await openBackend()

    setDefaultNeode(backend.neode)
    setFilterParams('tenant', 'acme')
  })

  beforeEach(() => {
    executed = []

    setFilterParams('tenant', 'acme')

    backend.neode.on(EventType.QUERY_EXECUTED, onQuery)
  })

  afterEach(async () => {
    backend.neode.off(EventType.QUERY_EXECUTED, onQuery)

    clearFilterParams()

    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('whereRelationship filters on the edge properties — only the matching target returns', async () => {
    const person = await seededRoles(backend.neode, ['Neo', 'Trinity', 'Neo'])

    const movies = await person.related('actedIn').whereRelationship({ role: 'Neo' }).find()

    expect(movies).toHaveLength(2)

    for (const movie of movies) {
      expect(movie).toBeInstanceOf(Movie)
    }

    await expect(
      person.related('actedIn').whereRelationship({ role: 'Trinity' }).count(),
    ).resolves.toBe(1)
    await expect(
      person.related('actedIn').whereRelationship({ role: 'Agent Smith' }).find(),
    ).resolves.toEqual([])
  })

  it('withRelationship returns the edge alongside the node, edge properties present', async () => {
    const person = await seededRoles(backend.neode, ['Neo', 'Trinity'])

    const rows = await person.related('actedIn').orderBy('year').withRelationship().find()

    expect(rows).toHaveLength(2)

    const [first, second] = rows

    expect(first?.node).toBeInstanceOf(Movie)
    expect(first?.edge.type).toBe('ACTED_IN')
    expect(first?.edge.properties).toMatchObject({ role: 'Neo' })

    expect(second?.node).toBeInstanceOf(Movie)
    expect(second?.edge.properties).toMatchObject({ role: 'Trinity' })

    // first() keeps the one-key cardinality: the row or undefined
    const row = await person
      .related('actedIn')
      .whereRelationship({ role: 'Neo' })
      .withRelationship()
      .first()

    expect(row?.edge.properties.role).toBe('Neo')
  })

  it('whereRelationship composes with where() and the global filters', async () => {
    const person = await seededRoles(backend.neode, ['Neo', 'Trinity', 'Neo'])

    // Target predicate AND edge predicate
    const both = await person
      .related('actedIn')
      .where({ year: 1999 })
      .whereRelationship({ role: 'Neo' })
      .find()

    expect(both).toHaveLength(1)

    // The global tenant filter still filters the traversal rows
    setFilterParams('tenant', 'other-tenant')

    await expect(
      person.related('actedIn').whereRelationship({ role: 'Neo' }).find(),
    ).resolves.toEqual([])

    setFilterParams('tenant', 'acme')
  })

  it('emits no OPTIONAL MATCH for the relationship-aware reads (NTS-565)', async () => {
    const person = await seededRoles(backend.neode, ['Neo'])

    await person.related('actedIn').where({ year: 1999 }).whereRelationship({ role: 'Neo' }).find()
    await person.related('actedIn').withRelationship().find()

    const statements = executed.map((event) => event.cypher)

    expect(statements.length).toBeGreaterThan(0)

    for (const statement of statements) {
      expect(statement).not.toContain('OPTIONAL MATCH')
    }
  })
})

describe('one-key related() reads one row (NTS-591)', () => {
  let backend: TestBackend

  let executed: QueryExecutedEvent[]

  const onQuery = (event: QueryExecutedEvent): void => {
    executed.push(event)
  }

  beforeAll(async () => {
    backend = await openBackend()

    setDefaultNeode(backend.neode)
  })

  beforeEach(() => {
    executed = []

    setFilterParams('tenant', 'acme')

    backend.neode.on(EventType.QUERY_EXECUTED, onQuery)
  })

  afterEach(async () => {
    backend.neode.off(EventType.QUERY_EXECUTED, onQuery)

    clearFilterParams()

    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  /** A saved person with one related movie per year, freshly re-found — the first year rides the one-key unless `withFavorite` is false */
  async function seededPerson(years: number[], withFavorite = true): Promise<WithMethods<Person>> {
    const person = new Person()
    person.name = `person-${Math.random()}`

    const savedPerson = (await backend.neode.save(person)) as WithMethods<Person>

    for (const [index, year] of years.entries()) {
      const movie = new Movie()
      movie.title = `Movie ${index}-${Math.random()}`
      movie.year = year
      movie.tenant = 'acme'

      const savedMovie = (await backend.neode.save(movie)) as WithMethods<Movie>

      await savedPerson.relateTo(savedMovie, withFavorite && index === 0 ? 'favorite' : 'actedIn')
    }

    return (await backend.neode.find(Person, savedPerson.id)) as WithMethods<Person>
  }

  it('find() on a one-key pushes LIMIT 1 into the traversal read', async () => {
    const person = await seededPerson([1999])

    executed = []

    const favorite = await person.related('favorite').find()

    expect(favorite).toBeInstanceOf(Movie)

    // One statement: the traversal read itself, one row
    expect(executed).toHaveLength(1)
    expect(executed[0]?.cypher).toContain('LIMIT 1')
  })

  it('a recorded limit stands — first() does not clobber it', async () => {
    const person = await seededPerson([2013, 1999, 2003], false)

    executed = []

    const first = await person.related('actedIn').orderBy('year').limit(2).first()

    expect(first).toBeInstanceOf(Movie)
    expect(first?.year).toBe(1999)

    const traversal = executed[0]?.cypher ?? ''

    expect(traversal).toContain('LIMIT 2')
    expect(traversal).not.toContain('LIMIT 1')
  })

  it('find() on a many-key reads every row (no LIMIT)', async () => {
    const person = await seededPerson([1999, 2003, 2013], false)

    executed = []

    const movies = await person.related('actedIn').find()

    expect(movies).toHaveLength(3)
    expect(executed[0]?.cypher).not.toContain('LIMIT')
  })
})
