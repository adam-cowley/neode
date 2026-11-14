// The backend import loads neode.service first, resolving the
// query.service -> utils -> neode.service module cycle before the
// imports below are evaluated
import { openBackend, TestBackend } from './support/backend'
import {
  NodeEntity,
  Uuid,
  Property,
  Number as NumberType,
  InternalId,
  DateTime,
  Default,
  Point,
} from '../../src/decorators'
import { Direction } from '../../src/query'
import { mergeRelationshipProperty } from '../../src/meta'

// ---- Fixtures: neode's example Person (example/Person.js), as decorators ---
//
// person_id: uuid primary, name: unique string, age: number, createdAt:
// datetime with a create-time default, knows: KNOWS outgoing (neode's
// adam.relateTo(joe, 'knows', { since })).

@NodeEntity()
class Person {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  person_id: string

  @Property({ type: 'string', unique: true })
  name: string

  @NumberType()
  age: number

  // neode's example defaults createdAt to `new Date()`. Driver temporal
  // params cannot pass the Relate FFI (see serialise.test.ts), so the
  // default produces an ISO string — still a create-time default.
  @DateTime()
  @Default(() => new Date().toISOString())
  createdAt: string

  // Self-referencing: registered through the metamodel, since a
  // relationship decorator would evaluate its Person factory before the
  // class binding exists
  knows: Person[]

  static create(name: string, age?: number): Person {
    const person = new Person()
    person.name = name

    if (age !== undefined) {
      person.age = age
    }

    return person
  }
}

mergeRelationshipProperty(Person, 'knows', 'KNOWS', Person, Direction.OUTGOING, true, true)

@NodeEntity()
class Place {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string

  @Point()
  location: { x: number; y: number }
}

// ---------------------------------------------------------------------------

describe('neode example flow (facade parity)', () => {
  let backend: TestBackend

  const count = async (query: string): Promise<number> => {
    const res = await backend.neode.readCypher(query)

    return Number(res.records[0].get('c'))
  }

  beforeAll(async () => {
    backend = await openBackend()
  })

  beforeEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.clearGraph()
    await backend.close()
  })

  it('creates two people with uuid ids and a createdAt default', async () => {
    const adam = await backend.neode.create(Person, { name: 'Adam', age: 30 })
    const joe = await backend.neode.create(Person, { name: 'Joe' })

    // uuid primary ids generated, create-time default applied
    expect(typeof adam.person_id).toBe('string')
    expect(adam.person_id).not.toBe(joe.person_id)
    expect(typeof adam.createdAt).toBe('string')
    expect(adam.createdAt).toBeTruthy()
    expect(adam.name).toBe('Adam')
    expect(adam.age).toBe(30)
    expect(joe.name).toBe('Joe')

    expect(await count('MATCH (n:Person) RETURN count(n) AS c')).toBe(2)
  })

  it('relates two people KNOWS with a since property, then eager-loads', async () => {
    const adam = await backend.neode.create(Person, { name: 'Adam' })
    const joe = await backend.neode.create(Person, { name: 'Joe' })

    // adam.relateTo(joe, 'knows', { since: ... })
    const rel = await backend.neode.relate(Person, adam, joe, 'knows', {
      since: '2017-01-02T12:34:56',
    })

    expect(rel).toBeDefined()
    expect(rel!.type).toBe('KNOWS')
    expect(rel!.properties.since).toBe('2017-01-02T12:34:56')

    // Exactly one outgoing edge with the property, nothing reversed
    const edges = await backend.neode.readCypher(
      'MATCH (:Person { name: "Adam" })-[r:KNOWS]->(:Person { name: "Joe" }) RETURN r.since AS since',
    )
    expect(edges.records).toHaveLength(1)
    expect(edges.records[0].get('since')).toBe('2017-01-02T12:34:56')

    expect(await count('MATCH (:Person { name: "Joe" })-[:KNOWS]->() RETURN count(*) AS c')).toBe(0)

    // MERGE semantics: relating again does not duplicate
    await backend.neode.relate(Person, adam, joe, 'knows', { since: '2017-01-02T12:34:56' })
    expect(await count('MATCH ()-[r:KNOWS]->() RETURN count(r) AS c')).toBe(1)

    // Eager load: KNOWS is declared eager — re-reading Adam hydrates Joe
    const eager = await backend.neode.find(Person, adam.person_id)
    expect(eager!.knows).toHaveLength(1)
    expect(eager!.knows[0]).toBeInstanceOf(Person)
    expect(eager!.knows[0].name).toBe('Joe')

    // detach removes just the relationship, both nodes survive
    await backend.neode.detach(Person, adam, joe, 'knows')
    expect(await count('MATCH ()-[r:KNOWS]->() RETURN count(r) AS c')).toBe(0)
    expect(await backend.neode.find(Person, adam.person_id)).toBeInstanceOf(Person)
    expect(await backend.neode.find(Person, joe.person_id)).toBeInstanceOf(Person)
  })

  it('updates a property through the facade', async () => {
    const adam = await backend.neode.create(Person, { name: 'Adam', age: 30 })

    const updated = await backend.neode.update(adam, { age: 31 })
    expect(updated!.age).toBe(31)

    const stored = await backend.neode.readCypher(
      'MATCH (n:Person { name: "Adam" }) RETURN n.age AS age',
    )
    expect(Number(stored.records[0].get('age'))).toBe(31)
  })

  it('queries all() with ordering, limit and skip', async () => {
    await backend.neode.create(Person, { name: 'Adam', age: 30 })
    await backend.neode.create(Person, { name: 'Joe', age: 25 })
    await backend.neode.create(Person, { name: 'Alan', age: 20 })

    const byName = await backend.neode.all(Person, {}, 'name')
    expect(byName.map((person) => person.name)).toEqual(['Adam', 'Alan', 'Joe'])

    const byAgeDesc = await backend.neode.all(Person, {}, { age: 'DESC' })
    expect(byAgeDesc.map((person) => person.name)).toEqual(['Adam', 'Joe', 'Alan'])

    const paged = await backend.neode.all(Person, {}, 'age', 1, 1)
    expect(paged.map((person) => person.name)).toEqual(['Joe'])
  })

  it('queries withinDistance() on a point property', async () => {
    if (!backend.capabilities.points) {
      return
    }

    // Point params cannot pass the Relate FFI — seed with native point()
    await backend.connection.run(
      "CREATE (:Place {name: 'Home', location: point({x: 0, y: 0})}) " +
        "CREATE (:Place {name: 'Near', location: point({x: 3, y: 4})}) " +
        "CREATE (:Place {name: 'Far', location: point({x: 30, y: 40})})",
    )

    const near = await backend.neode.withinDistance(Place, 'location', { x: 0, y: 0 }, 10)
    expect(near.map((place) => place.name).sort()).toEqual(['Home', 'Near'])

    const byDistance = await backend.neode.withinDistance(
      Place,
      'location',
      { x: 0, y: 0 },
      100,
      {},
      'distance',
    )
    expect(byDistance.map((place) => place.name)).toEqual(['Home', 'Near', 'Far'])
  })

  it('deletes with cascade modes', async () => {
    // Plain delete: Adam goes, related Joe survives
    const adam = await backend.neode.create(Person, { name: 'Adam' })
    const joe = await backend.neode.create(Person, { name: 'Joe' })
    await backend.neode.relate(Person, adam, joe, 'knows', {})

    await backend.neode.delete(adam)

    expect(await count('MATCH (n:Person { name: "Adam" }) RETURN count(n) AS c')).toBe(0)
    expect(await count('MATCH (n:Person { name: "Joe" }) RETURN count(n) AS c')).toBe(1)

    // Cascade delete: the KNOWS branch goes with it
    const adam2 = await backend.neode.create(Person, { name: 'Adam2' })
    const joe2 = await backend.neode.create(Person, { name: 'Joe2' })
    await backend.neode.relate(Person, adam2, joe2, 'knows', {})

    await backend.neode.delete(adam2, { cascade: true })

    expect(await count('MATCH (n:Person { name: "Adam2" }) RETURN count(n) AS c')).toBe(0)
    expect(await count('MATCH (n:Person { name: "Joe2" }) RETURN count(n) AS c')).toBe(0)
    expect(await count('MATCH (n:Person { name: "Joe" }) RETURN count(n) AS c')).toBe(1)
  })

  it('runs the full flow inside a write transaction and rolls it back', async () => {
    const marker = await backend.neode.inWriteTransaction(async (tx) => {
      try {
        // Create (save merges on the unique name)
        const adam = await tx.save(Person.create('TxAdam', 30))
        const joe = await tx.save(Person.create('TxJoe', 25))

        expect(typeof adam.person_id).toBe('string')
        expect(adam.createdAt).toBeTruthy()

        // Relate
        const rel = await tx.relate(Person, adam, joe, 'knows', {
          since: '2020-01-01T00:00:00',
        })
        expect(rel).toBeDefined()

        // Eager-load
        const found = await tx.find(Person, adam.person_id)
        expect(found!.knows).toHaveLength(1)
        expect(found!.knows[0].name).toBe('TxJoe')

        // Update
        const updated = await tx.update(adam, { age: 31 })
        expect(updated!.age).toBe(31)

        // all() ordering
        const all = await tx.all(Person, {}, 'name')
        expect(all.map((person) => person.name)).toEqual(['TxAdam', 'TxJoe'])

        // Delete. Gap: the embedded Relate engine panics on ANY delete
        // inside an explicit transaction ("update counters are
        // non-negative", binding.rs) and poisons the connection, so
        // this step only runs on Bolt backends (see task report).
        if (backend.name !== 'relate') {
          await tx.delete(adam, { cascade: true })

          const remaining = await tx.all(Person, {})
          expect(remaining.map((person) => person.name)).toEqual([])
        }

        await tx.rollback()

        return true
      } catch (error) {
        await tx.rollback()

        throw error
      }
    })

    expect(marker).toBe(true)

    // Nothing persisted after the rollback
    expect(await count('MATCH (n:Person) RETURN count(n) AS c')).toBe(0)
    expect(await count('MATCH ()-[r:KNOWS]->() RETURN count(r) AS c')).toBe(0)
  })
})
