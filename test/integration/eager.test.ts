import {
  NodeEntity,
  Uuid,
  Property,
  InternalId,
  OneToMany,
  RelationshipEntity,
  StartNode,
  EndNode,
} from '../../src/decorators'
import { openBackend, TestBackend } from './support/backend'
import { Direction } from '../../src/query'
import { Builder } from '../../src/query'
import { getModel, mergeRelationshipProperty } from '../../src/meta'
import { THIS_NODE } from '../../src/constants'
import { QueryService } from '../../src/services/query/query.service'
import type { Runner } from '../../src/driver/types'

// ---- Fixtures (per-file: decorator registry is global per module registry) --
//
// Three-degree eager chain:
//   (Person)-[:ACTED_IN]->(Movie)-[:RELEASED]->(Studio)-[:HEADQUARTERED_IN]->(Country)
// plus a relationship entity on the first degree and a fourth degree
// (Country)-[:PART_OF]->(Continent) that must be cut off by MAX_EAGER_DEPTH.

@NodeEntity()
class Country {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string
}

@NodeEntity()
class Continent {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string
}

@NodeEntity()
class Studio {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string

  headquarters: Country
}

@NodeEntity()
class Movie {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  title: string

  releasedBy: Studio
  sequel: Movie
}

@NodeEntity()
class Person {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string

  @OneToMany(() => Movie, 'ACTED_IN', Direction.OUTGOING, true)
  movies: Movie[]

  directed: Directed
}

@RelationshipEntity()
class Directed {
  @Property({ type: 'string' })
  billing: string

  @StartNode(() => Person)
  person: Person

  @EndNode(() => Movie)
  movie: Movie
}

// Singular relationships: @OneToOne resolves its target from design:type
// metadata, which the vitest transform does not emit for test files, so the
// singular fixtures are registered through the metamodel directly (the same
// registry entry point the decorators themselves call).
mergeRelationshipProperty(
  Studio,
  'headquarters',
  'HEADQUARTERED_IN',
  Country,
  Direction.OUTGOING,
  false,
  true,
)
mergeRelationshipProperty(Movie, 'releasedBy', 'RELEASED', Studio, Direction.OUTGOING, false, true)
mergeRelationshipProperty(Movie, 'sequel', 'SEQUEL_TO', Movie, Direction.OUTGOING, false, false)
mergeRelationshipProperty(Country, 'partOf', 'PART_OF', Continent, Direction.OUTGOING, false, true)
mergeRelationshipProperty(Person, 'directed', 'DIRECTED', Directed, Direction.OUTGOING, false, true)

// ---------------------------------------------------------------------------

describe('Multi-degree eager loading', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  /**
   * Save the three-degree chain. The first save cascades the ACTED_IN
   * branch (Movie -> Studio -> Country); the second attaches the
   * relationship entity. `movies` is unset in between so the two saves
   * never cascade the same nodes concurrently.
   */
  async function seedChain(): Promise<Person> {
    const country = new Country()
    country.name = 'Australia'

    const studio = new Studio()
    studio.name = 'Village Roadshow'
    studio.headquarters = country

    const movie = new Movie()
    movie.title = 'The Matrix'
    movie.releasedBy = studio

    const person = new Person()
    person.name = 'Adam'
    person.movies = [movie]

    await backend.neode.save(person)

    const directed = new Directed()
    directed.billing = 'Main title card'
    directed.movie = movie

    person.movies = undefined
    person.directed = directed

    // save() returns a hydrated instance; the input is not mutated,
    // so return the saved instance (carrying the primary key)
    return backend.neode.save(person)

    // A non-eager relationship that must not be hydrated
    const sequel = new Movie()
    sequel.title = 'The Matrix Reloaded'
    await backend.neode.save(sequel)

    await backend.connection.run(
      'MATCH (a:Movie { title: "The Matrix" }), (b:Movie { title: "The Matrix Reloaded" }) ' +
        'CREATE (b)-[:SEQUEL_TO]->(a)',
    )

    return person
  }

  it('hydrates eager relationships to three degrees on get', async () => {
    await seedChain()

    const results = await backend.neode.get(Person, { name: 'Adam' })

    expect(results).toHaveLength(1)

    const person = results[0]

    // Degree 1: nested entity hydrated as class instances
    expect(person.movies).toHaveLength(1)
    expect(person.movies[0]).toBeInstanceOf(Movie)
    expect(person.movies[0].title).toBe('The Matrix')

    expect(person.directed).toBeInstanceOf(Directed)
    expect(person.directed.billing).toBe('Main title card')
    expect(person.directed.person).toBeInstanceOf(Person)
    expect(person.directed.movie).toBeInstanceOf(Movie)
    expect(person.directed.movie.title).toBe('The Matrix')

    // Degree 2: nested through the degree-1 entity
    const movie = person.movies[0]
    expect(movie.releasedBy).toBeInstanceOf(Studio)
    expect(movie.releasedBy.name).toBe('Village Roadshow')

    // Degree 3: reachable
    const studio = movie.releasedBy
    expect(studio.headquarters).toBeInstanceOf(Country)
    expect(studio.headquarters.name).toBe('Australia')

    // Degree 4 is cut off by MAX_EAGER_DEPTH
    expect(studio.headquarters.partOf).toBeUndefined()

    // Non-eager relationships stay undefined
    expect(movie.sequel).toBeUndefined()

    // Eager markers do not leak onto entity instances
    expect((person as Record<string, unknown>)['__EAGER_ID__']).toBeUndefined()
    expect((person as Record<string, unknown>)['__EAGER_LABELS__']).toBeUndefined()
    expect((movie as Record<string, unknown>)['__EAGER_ID__']).toBeUndefined()
    expect((movie as Record<string, unknown>)['__EAGER_LABELS__']).toBeUndefined()
    expect((movie.releasedBy as Record<string, unknown>)['__EAGER_ID__']).toBeUndefined()
    expect((studio.headquarters as Record<string, unknown>)['__EAGER_LABELS__']).toBeUndefined()
    expect((person.directed as Record<string, unknown>)['__EAGER_ID__']).toBeUndefined()
    expect((person.directed as Record<string, unknown>)['__EAGER_TYPE__']).toBeUndefined()
  })

  it('hydrates eager relationships on find', async () => {
    const saved = await seedChain()

    const found = await backend.neode.find(Person, saved.id)

    expect(found).toBeInstanceOf(Person)

    const person = found as Person

    expect(person.movies[0]).toBeInstanceOf(Movie)
    expect(person.movies[0].releasedBy).toBeInstanceOf(Studio)
    expect(person.movies[0].releasedBy.headquarters).toBeInstanceOf(Country)
    expect(person.movies[0].releasedBy.headquarters.name).toBe('Australia')
    expect(person.directed.movie.title).toBe('The Matrix')
  })

  it('nests eager patterns up to three degrees in the generated query', async () => {
    const queries: string[] = []

    const runner = {
      run: async (query: string) => {
        queries.push(query)

        return { records: [] }
      },
    }

    const service = new QueryService(runner as unknown as Runner)

    const builder = new Builder()
    builder.match(THIS_NODE, getModel(Person).getLabels())

    await service.return(Person, getModel(Person), builder)

    const [query] = queries

    // Degrees 1 to 3 are projected
    expect(query).toContain('this_movies_rel:`ACTED_IN`')
    expect(query).toContain('this_movies_node_releasedBy_rel:`RELEASED`')
    expect(query).toContain('this_movies_node_releasedBy_node_headquarters_rel:`HEADQUARTERED_IN`')

    // ...and the fourth degree is cut off by MAX_EAGER_DEPTH
    expect(query).not.toContain('partOf')
  })
})
