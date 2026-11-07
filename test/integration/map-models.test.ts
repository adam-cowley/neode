import { openBackend, TestBackend } from './support/backend'
import type { Newable } from '../../src/meta/newable'
import type { SchemaDefinition } from '../../src/meta/schema-definition.interface'

// ---- Fixtures (map-based definitions; registry is global per file) ---------

interface PersonInstance {
  name: string
  id?: string
  _id?: string
  knows?: PersonInstance
}

interface EmployeeInstance extends PersonInstance {
  payroll?: number
}

function instance<T>(constructor: Newable): T {
  return new (constructor as new () => T)()
}

const personSchema: SchemaDefinition = {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  knows: {
    type: 'relationship',
    relationship: 'KNOWS',
    direction: 'out',
    target: 'Person',
    eager: true,
  },
}

const movieSchema: SchemaDefinition = {
  id: { type: 'uuid', primary: true },
  title: { type: 'string', unique: true },
}

// ---------------------------------------------------------------------------

describe('Map-based models', () => {
  let backend: TestBackend
  let Person: Newable
  let Movie: Newable

  beforeAll(async () => {
    backend = await openBackend()

    backend.neode.with({ Person: personSchema, Movie: movieSchema })

    Person = backend.neode.model('Person')
    Movie = backend.neode.model('Movie')
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  describe('save', () => {
    it('saves and hydrates a map-defined model', async () => {
      const person = instance<PersonInstance>(Person)
      person.name = 'Adam'

      const saved = await backend.neode.save(person)

      expect(saved).toBeInstanceOf(Person)
      expect(saved.name).toEqual('Adam')
      expect(saved._id).toBeDefined()
      expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })

    it('is idempotent when merging on a unique property', async () => {
      const first = instance<PersonInstance>(Person)
      first.name = 'Adam'

      const second = instance<PersonInstance>(Person)
      second.name = 'Adam'

      const savedFirst = await backend.neode.save(first)
      const savedSecond = await backend.neode.save(second)

      expect(savedSecond._id).toEqual(savedFirst._id)
    })

    it('saves relationship targets and relates them', async () => {
      const adam = instance<PersonInstance>(Person)
      adam.name = 'Adam'

      const bob = instance<PersonInstance>(Person)
      bob.name = 'Bob'
      bob.knows = adam

      await backend.neode.save(bob)

      const result = await backend.neode.readCypher(
        'MATCH (a:Person { name: "Adam" })-[k:KNOWS]-(b:Person { name: "Bob" }) RETURN count(k) AS rels',
      )

      expect(Number(result.records[0].get('rels'))).toEqual(1)
    })
  })

  describe('find / get', () => {
    it('finds a map-defined model by primary key', async () => {
      const person = instance<PersonInstance>(Person)
      person.name = 'Adam'

      const saved = await backend.neode.save(person)

      const found = await backend.neode.find(Person, saved.id)

      expect(found).toBeInstanceOf(Person)
      expect((found as PersonInstance).name).toEqual('Adam')
    })

    it('gets map-defined models by params', async () => {
      const person = instance<PersonInstance>(Person)
      person.name = 'Adam'

      await backend.neode.save(person)

      const results = await backend.neode.get(Person, { name: 'Adam' })

      expect(results).toHaveLength(1)
      expect(results[0]).toBeInstanceOf(Person)
      expect((results[0] as PersonInstance).name).toEqual('Adam')
    })

    it('hydrates eager relationships', async () => {
      const adam = instance<PersonInstance>(Person)
      adam.name = 'Adam'

      const bob = instance<PersonInstance>(Person)
      bob.name = 'Bob'
      bob.knows = adam

      await backend.neode.save(bob)

      const results = await backend.neode.get(Person, { name: 'Bob' })

      expect(results).toHaveLength(1)

      const hydrated = results[0] as PersonInstance

      expect(hydrated.knows).toBeInstanceOf(Person)
      expect((hydrated.knows as PersonInstance).name).toEqual('Adam')
    })

    it('gets Movie models defined alongside Person', async () => {
      const movie = instance<{ title: string }>(Movie)

      movie.title = 'The Matrix'

      const saved = await backend.neode.save(movie)

      expect(saved).toBeInstanceOf(Movie)

      const results = await backend.neode.get(Movie, { title: 'The Matrix' })

      expect(results).toHaveLength(1)
    })
  })

  describe('extend', () => {
    it('saves the extended model with both labels', async () => {
      const Employee = backend.neode.extend('Person', 'Employee', {
        payroll: { type: 'number' },
      })

      const employee = instance<EmployeeInstance>(Employee)
      employee.name = 'Sarah'
      employee.payroll = 100

      const saved = await backend.neode.save(employee)

      expect(saved).toBeInstanceOf(Employee)

      const result = await backend.neode.readCypher(
        'MATCH (e:Employee { name: "Sarah" }) RETURN labels(e) AS labels, e.payroll AS payroll',
      )

      const labels = result.records[0].get('labels') as string[]

      expect(labels).toContain('Employee')
      expect(labels).toContain('Person')
      expect(result.records[0].get('payroll')).toEqual(100)
    })
  })
})
