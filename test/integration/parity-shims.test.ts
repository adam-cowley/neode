import {
  InternalId,
  NodeEntity,
  Number as NumberProperty,
  OneToMany,
  String as StringProperty,
  Uuid,
} from '../../src/decorators'
import { Direction } from '../../src/query'
import { Collection } from '../../src'
import { hydrate, hydrateFirst, toCollection } from '../../src/hydrate'
import { QueryOutput } from '../../src/driver/types'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --
// Pet first: relationship decorators evaluate their target factory eagerly

@NodeEntity()
class Pet {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @StringProperty({ unique: true })
  name: string

  static create(name: string): Pet {
    const pet = new Pet()
    pet.name = name

    return pet
  }
}

@NodeEntity()
class Person {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @StringProperty({ unique: true })
  name: string

  @NumberProperty()
  age: number

  @OneToMany(() => Pet, 'OWNS', Direction.OUTGOING)
  pets: Pet[]

  static create(name: string, age?: number): Person {
    const person = new Person()
    person.name = name

    if (age !== undefined) {
      person.age = age
    }

    return person
  }
}

// The hydrate module infers the virtual/unknown instance type through the
// Newable boundary — assertions use the hydrated shape
interface HydratedPerson {
  _id: string
  name: string
  pets?: Array<{ name: string }>
}

const hydratePersons = (res: QueryOutput, alias?: string) =>
  hydrate(Person, res, alias) as HydratedPerson[]

// ---------------------------------------------------------------------------

describe('P4.11 parity shims', () => {
  let backend: TestBackend

  const count = async (query: string): Promise<number> => {
    const res = await backend.neode.readCypher(query)

    return Number(res.records[0].get('c'))
  }

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  describe('merge', () => {
    it('creates a node when no match exists, merging on the unique properties', async () => {
      const merged = await backend.neode.merge(Person, {
        name: 'Adam',
        age: 30,
      })

      expect(merged).toBeInstanceOf(Person)
      expect(merged!.name).toBe('Adam')
      expect(merged!.age).toBe(30)
      expect(merged!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })

    it('matches an existing node on its unique property and sets the rest', async () => {
      const saved = await backend.neode.save(Person.create('Adam'))

      const merged = await backend.neode.merge(Person, {
        name: 'Adam',
        age: 31,
      })

      expect(merged!._id).toBe(saved._id)
      expect(merged!.age).toBe(31)

      expect(await count('MATCH (n:Person) RETURN count(n) AS c')).toBe(1)
    })
  })

  describe('deleteAll', () => {
    it('detaches and deletes only the matching nodes, returning the count', async () => {
      await backend.neode.save(Person.create('Del', 1))
      await backend.neode.save(Person.create('AlsoDel', 2))
      await backend.neode.save(Person.create('Keep', 3))
      await backend.neode.save(Pet.create('Rex'))

      const deleted = await backend.neode.deleteAll(Person, { name: 'Del' })

      expect(deleted).toBe(1)
      expect(await count('MATCH (n:Person) RETURN count(n) AS c')).toBe(2)
      expect(await count('MATCH (n:Pet) RETURN count(n) AS c')).toBe(1)
    })

    it('deletes every node of the label when confirmed with { all: true }', async () => {
      await backend.neode.save(Person.create('A'))
      await backend.neode.save(Person.create('B'))

      // An unfiltered deleteAll is refused (NTS-595 destructive guard)
      await expect(backend.neode.deleteAll(Person)).rejects.toThrow(/deleteAll\(\) refused/)

      expect(await backend.neode.deleteAll(Person, { all: true })).toBe(2)
      expect(await count('MATCH (n:Person) RETURN count(n) AS c')).toBe(0)
    })
  })

  describe('first', () => {
    it('finds a node by key and value', async () => {
      await backend.neode.save(Person.create('Adam'))

      const found = await backend.neode.first(Person, 'name', 'Adam')

      expect(found).toBeInstanceOf(Person)
      expect(found!.name).toBe('Adam')
    })

    it('accepts a map of properties and returns undefined without a match', async () => {
      await backend.neode.save(Person.create('Adam', 30))

      const mapFound = await backend.neode.first(Person, { name: 'Adam', age: 30 })
      const missing = await backend.neode.first(Person, 'name', 'Nobody')

      expect(mapFound).toBeInstanceOf(Person)
      expect(missing).toBeUndefined()
    })
  })

  describe('query', () => {
    it('returns a Builder whose execute round-trips through the connection', async () => {
      await backend.neode.save(Person.create('Adam'))

      const output = await backend.neode
        .query()
        .match('n', 'Person')
        .where('n.name', 'Adam')
        .return('n')
        .execute(backend.neode.getConnection(), 'READ')

      expect(output.records).toHaveLength(1)
      expect((output.records[0].get('n') as { properties: { name: string } }).properties.name).toBe(
        'Adam',
      )
    })
  })

  describe('relate by type', () => {
    it('resolves a relationship by its type name as well as its key', async () => {
      const adam = await backend.neode.save(Person.create('Adam'))
      const rex = await backend.neode.save(Pet.create('Rex'))

      // By TYPE ('OWNS'), not by definition key ('pets')
      await backend.neode.relate(Person, adam, rex, 'OWNS')

      expect(
        await count('MATCH (:Person { name: "Adam" })-[r:OWNS]->(:Pet) RETURN count(r) AS c'),
      ).toBe(1)

      // By KEY still works
      await backend.neode.relate(Person, adam, rex, 'pets', {}, true)

      expect(
        await count('MATCH (:Person { name: "Adam" })-[r:OWNS]->(:Pet) RETURN count(r) AS c'),
      ).toBe(2)
    })

    it('errors when neither a key nor a type matches', async () => {
      const adam = await backend.neode.save(Person.create('Adam'))
      const rex = await backend.neode.save(Pet.create('Rex'))

      await expect(backend.neode.relate(Person, adam, rex, 'NOT_A_RELATIONSHIP')).rejects.toThrow(
        /Unknown relationship/,
      )
    })
  })

  describe('hydrate', () => {
    it('hydrates a raw readCypher result into typed entities and collections', async () => {
      const adam = await backend.neode.save(Person.create('Adam'))
      const rex = await backend.neode.save(Pet.create('Rex'))
      await backend.neode.relate(Person, adam, rex, 'OWNS')

      const res = await backend.neode.readCypher(
        'MATCH (p:Person { name: "Adam" }) OPTIONAL MATCH (p)-[:OWNS]->(pet) RETURN p AS this, pet AS pets',
      )

      const entities = hydratePersons(res)
      const collection = toCollection(Person, res) as Collection<HydratedPerson>

      expect(entities).toHaveLength(1)
      expect(entities[0]).toBeInstanceOf(Person)
      expect(entities[0].name).toBe('Adam')
      expect(entities[0]._id).toBe(adam._id)
      expect(entities[0].pets![0]).toBeInstanceOf(Pet)
      expect(entities[0].pets![0].name).toBe('Rex')

      expect(collection).toBeInstanceOf(Collection)
      expect(collection.length).toBe(1)
    })

    it('plucks a custom alias column and returns undefined for hydrateFirst on a miss', async () => {
      await backend.neode.save(Person.create('Adam'))

      const res = await backend.neode.readCypher(
        'MATCH (p:Person { name: "Adam" }) RETURN p AS node',
      )

      const entities = hydratePersons(res, 'node')

      expect(entities).toHaveLength(1)
      expect(entities[0].name).toBe('Adam')

      const miss = await backend.neode.readCypher(
        'OPTIONAL MATCH (p:Person { name: "Nobody" }) RETURN p AS this',
      )

      expect(hydrateFirst(Person, miss)).toBeUndefined()
    })
  })
})
