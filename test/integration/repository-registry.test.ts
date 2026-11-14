import { Repository } from '../../src/repository'
import {
  NodeEntity,
  InternalId,
  Uuid,
  Property,
  Number,
  EntityRepository,
} from '../../src/decorators'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Person {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string

  @Number()
  age: number

  static create(name: string, age: number): Person {
    const person = new Person()
    person.name = name
    person.age = age

    return person
  }
}

@EntityRepository(Person)
class PeopleRepository extends Repository<Person> {
  /** Domain method: every saved person aged 18 or over */
  findAdults(): Promise<Person[]> {
    return this.findAll().then((people) => people.filter((person) => person.age >= 18))
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

// ---------------------------------------------------------------------------

describe('Repository registry', () => {
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

  it('resolves the registered custom repository from neode.getRepository', () => {
    const people = backend.neode.getRepository(Person)

    expect(people).toBeInstanceOf(PeopleRepository)
    expect(people).toBeInstanceOf(Repository)
  })

  it('falls back to the default Repository when none is registered', () => {
    const movies = backend.neode.getRepository(Movie)

    expect(movies).toBeInstanceOf(Repository)
    expect(movies).not.toBeInstanceOf(PeopleRepository)
  })

  it('executes the custom repository domain method against the database', async () => {
    const people = backend.neode.getRepository(Person) as PeopleRepository

    await people.saveAll([
      Person.create('Alice', 30),
      Person.create('Bob', 12),
      Person.create('Carol', 18),
    ])

    const adults = await people.findAdults()

    expect(adults.map((person) => person.name).sort()).toEqual(['Alice', 'Carol'])
    expect(await people.count()).toBe(3)
  })
})
