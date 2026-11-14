// The backend import loads neode.service first, resolving the
// query.service -> utils -> neode.service module cycle before the
// query services below are evaluated
import { openBackend, TestBackend } from './support/backend'
import { setDefaultNeode } from '../../src/entity-methods'
import type { WithMethods } from '../../src/entity-methods'
import { InternalId, NodeEntity, OneToMany, Property, Uuid } from '../../src/decorators'
import { Direction } from '../../src/query'
import type { Newable } from '../../src/meta/newable'
import type { SchemaDefinition } from '../../src/meta/schema-definition.interface'

// ---- Fixtures (per-file: decorator registry is global per module) -----------

@NodeEntity()
class Pet {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string
}

@NodeEntity()
class Person {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string

  @OneToMany(() => Pet, 'OWNS', Direction.OUTGOING)
  pets: Pet[]
}

// A user class that defines its own save() — the wired methods must not
// clobber it (partial adoption: the other methods still apply)
@NodeEntity()
class Stubborn {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string

  save(): this {
    return this
  }
}

// Map-defined model, self-referencing relationship
interface MapPersonInstance {
  id?: string
  name?: string
  knows?: MapPersonInstance
}

const mapPersonSchema: SchemaDefinition = {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  knows: {
    type: 'relationship',
    relationship: 'KNOWS',
    direction: 'out',
    target: 'MapPerson',
    eager: true,
  },
}

function instance<T>(constructor: Newable): T {
  return new (constructor as new () => T)()
}

// ---------------------------------------------------------------------------

describe('Entity instance methods', () => {
  let backend: TestBackend
  let MapPerson: Newable

  beforeAll(async () => {
    backend = await openBackend()

    setDefaultNeode(backend.neode)

    backend.neode.with({ MapPerson: mapPersonSchema })

    MapPerson = backend.neode.model('MapPerson')
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  describe('prototype wiring', () => {
    it('wires methods onto the prototype once, not per instance', async () => {
      const person = new Person()
      person.name = 'Ada'

      const saved = await backend.neode.save(person)

      // A fresh instance of the registered class picks the methods up
      // from the prototype — no per-instance copies
      const fresh = new Person()

      expect(typeof (fresh as WithMethods<Person>).save).toEqual('function')
      expect(Object.hasOwn(fresh, 'save')).toBe(false)

      // and the saved instance itself is wired too
      const withMethods = saved as WithMethods<Person>
      expect(typeof withMethods.update).toEqual('function')
    })

    it('does not clobber a user-defined save (partial adoption)', async () => {
      const stubborn = new Stubborn()
      stubborn.name = 'Stub'

      const saved = await backend.neode.save(stubborn)

      // The user's own save() wins...
      expect(saved.save()).toBe(saved)

      // ...while the remaining methods are still wired
      expect(typeof (saved as unknown as WithMethods<Stubborn>).delete).toEqual('function')
    })
  })

  describe('save', () => {
    it('persists a new instance and re-hydrates onto it', async () => {
      const person = new Person()
      person.name = 'Ada'

      const saved = await (person as WithMethods<Person>).save()

      expect(saved).toBe(person)
      expect(person.id).toBeDefined()
      expect(person._id).toBeDefined()

      const result = await backend.neode.readCypher(
        'MATCH (p:Person { name: "Ada" }) RETURN count(p) AS n',
      )

      expect(Number(result.records[0].get('n'))).toEqual(1)
    })

    it('persists mutations made on an entity returned from save', async () => {
      const person = new Person()
      person.name = 'Ada'

      const saved = await backend.neode.save(person)

      const withMethods = saved as WithMethods<Person>
      withMethods.name = 'Grace'

      await withMethods.save()

      const result = await backend.neode.readCypher(
        'MATCH (p:Person { name: "Grace" }) RETURN count(p) AS n',
      )

      expect(Number(result.records[0].get('n'))).toEqual(1)
    })

    it('persists mutations made on an entity returned from find', async () => {
      const person = new Person()
      person.name = 'Ada'

      const saved = await backend.neode.save(person)

      const found = (await backend.neode.find(Person, (saved as Person).id)) as WithMethods<Person>

      found.name = 'Grace'

      await found.save()

      const result = await backend.neode.readCypher('MATCH (p:Person) RETURN p.name AS name')

      expect(result.records[0].get('name')).toEqual('Grace')
    })
  })

  describe('update', () => {
    it('updates properties on an entity returned from get', async () => {
      const person = new Person()
      person.name = 'Ada'

      await backend.neode.save(person)

      const results = await backend.neode.get(Person, { name: 'Ada' })

      const withMethods = results[0] as WithMethods<Person>

      const updated = await withMethods.update({ name: 'Ada Lovelace' })

      expect(updated).toBe(withMethods)
      expect(withMethods.name).toEqual('Ada Lovelace')

      const result = await backend.neode.readCypher('MATCH (p:Person) RETURN p.name AS name')

      expect(result.records[0].get('name')).toEqual('Ada Lovelace')
    })
  })

  describe('delete', () => {
    it('removes the node from the graph', async () => {
      const person = new Person()
      person.name = 'Ada'

      const saved = (await backend.neode.save(person)) as WithMethods<Person>

      await saved.delete()

      const result = await backend.neode.readCypher('MATCH (p:Person) RETURN count(p) AS n')

      expect(Number(result.records[0].get('n'))).toEqual(0)
    })
  })

  describe('relateTo / detachFrom', () => {
    it('relates and detaches two decorator-defined entities', async () => {
      const person = new Person()
      person.name = 'Ada'

      const pet = new Pet()
      pet.name = 'Rex'

      const savedPerson = (await backend.neode.save(person)) as WithMethods<Person>
      const savedPet = (await backend.neode.save(pet)) as WithMethods<Pet>

      const rel = await savedPerson.relateTo(savedPet, 'pets')

      expect(rel).toBeDefined()

      const related = await backend.neode.readCypher(
        'MATCH (:Person { name: "Ada" })-[o:OWNS]->(:Pet { name: "Rex" }) RETURN count(o) AS n',
      )

      expect(Number(related.records[0].get('n'))).toEqual(1)

      await savedPerson.detachFrom(savedPet, 'pets')

      const detached = await backend.neode.readCypher(
        'MATCH (:Person { name: "Ada" })-[o:OWNS]->(:Pet { name: "Rex" }) RETURN count(o) AS n',
      )

      expect(Number(detached.records[0].get('n'))).toEqual(0)

      // Both nodes survive the detach
      const nodes = await backend.neode.readCypher('MATCH (n) RETURN count(n) AS n')

      expect(Number(nodes.records[0].get('n'))).toEqual(2)
    })

    it('works on map-defined models', async () => {
      const adam = instance<MapPersonInstance>(MapPerson)
      adam.name = 'Adam'

      const bob = instance<MapPersonInstance>(MapPerson)
      bob.name = 'Bob'

      const savedAdam = (await backend.neode.save(adam)) as WithMethods<MapPersonInstance>
      const savedBob = (await backend.neode.save(bob)) as WithMethods<MapPersonInstance>

      const rel = await savedAdam.relateTo(savedBob, 'knows')

      expect(rel).toBeDefined()

      const related = await backend.neode.readCypher(
        'MATCH (:MapPerson { name: "Adam" })-[k:KNOWS]->(:MapPerson { name: "Bob" }) RETURN count(k) AS n',
      )

      expect(Number(related.records[0].get('n'))).toEqual(1)

      await savedAdam.detachFrom(savedBob, 'knows')

      const detached = await backend.neode.readCypher(
        'MATCH (:MapPerson)-[k:KNOWS]->() RETURN count(k) AS n',
      )

      expect(Number(detached.records[0].get('n'))).toEqual(0)
    })
  })
})
