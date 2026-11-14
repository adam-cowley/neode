import { NodeEntity, Uuid, Property, InternalId, Number } from '../../src/decorators'
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

  static create(name: string, age?: number): Person {
    const person = new Person()
    person.name = name

    if (age !== undefined) {
      person.age = age
    }

    return person
  }
}

// ---------------------------------------------------------------------------

describe('Entity lifecycle', () => {
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

  describe('save', () => {
    it('saves a new entity and hydrates it back', async () => {
      const saved = await backend.neode.save(Person.create('Adam'))

      expect(saved).toBeInstanceOf(Person)
      expect(saved.name).toBe('Adam')
      expect(saved.id).toBeDefined()
      expect(typeof saved.id).toBe('string')
      expect(saved._id).toBeDefined()
    })

    it('generates a uuid for uuid-typed primary keys', async () => {
      const saved = await backend.neode.save(Person.create('Adam'))

      expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })

    it('is idempotent for the same unique value', async () => {
      const first = await backend.neode.save(Person.create('Adam'))
      const second = await backend.neode.save(Person.create('Adam'))

      expect(second._id).toBe(first._id)
    })
  })

  describe('find', () => {
    it('finds an entity by its primary key', async () => {
      const saved = await backend.neode.save(Person.create('Adam'))

      const found = await backend.neode.find(Person, saved.id)

      expect(found).toBeInstanceOf(Person)
      expect(found.name).toBe('Adam')
    })

    it('returns undefined for an unknown primary key', async () => {
      const found = await backend.neode.find(Person, 'no-such-id')

      expect(found).toBeUndefined()
    })
  })

  describe('findById', () => {
    it('finds an entity by element ID', async () => {
      const saved = await backend.neode.save(Person.create('Adam'))

      const found = await backend.neode.findById(Person, saved._id)

      expect(found).toBeInstanceOf(Person)
      expect(found.name).toBe('Adam')
    })
  })

  describe('get', () => {
    it('finds entities by property match', async () => {
      await backend.neode.save(Person.create('Adam', 30))
      await backend.neode.save(Person.create('Ada', 31))
      await backend.neode.save(Person.create('Alan', 40))

      const results = await backend.neode.get(Person, { age: 31 })

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Ada')
    })

    it('supports limit and skip', async () => {
      await backend.neode.save(Person.create('Adam'))
      await backend.neode.save(Person.create('Ada'))
      await backend.neode.save(Person.create('Alan'))

      const results = await backend.neode.get(Person, {}, 1, 1)

      expect(results).toHaveLength(1)
    })

    it('returns an empty array when nothing matches', async () => {
      const results = await backend.neode.get(Person, { name: 'Nobody' })

      expect(results).toEqual([])
    })
  })

  describe('getFirst', () => {
    it('returns the first matching entity', async () => {
      await backend.neode.save(Person.create('Adam'))

      const first = await backend.neode.getFirst(Person, { name: 'Adam' })

      expect(first).toBeInstanceOf(Person)
    })
  })

  describe('delete', () => {
    it('deletes an entity', async () => {
      const saved = await backend.neode.save(Person.create('Adam'))

      await backend.neode.delete(saved)

      const found = await backend.neode.find(Person, saved.id)

      expect(found).toBeUndefined()
    })
  })

  describe('transactions', () => {
    it('persists work committed in an explicit transaction', async () => {
      const tx = await backend.neode.openWriteTransaction()

      await tx.save(Person.create('Committed'))
      await tx.commit()

      const found = await backend.neode.getFirst(Person, { name: 'Committed' })
      expect(found).toBeDefined()
    })

    it('discards work rolled back in an explicit transaction', async () => {
      const tx = await backend.neode.openWriteTransaction()

      await tx.save(Person.create('RolledBack'))
      await tx.rollback()

      const found = await backend.neode.getFirst(Person, { name: 'RolledBack' })
      expect(found).toBeUndefined()
    })

    it('exposes cypher access within a transaction scope', async () => {
      const result = await backend.neode.inWriteTransaction(async (tx) => {
        const output = await tx.writeCypher('CREATE (p:Person {name: $name}) RETURN p', {
          name: 'Cypher',
        })

        await tx.commit()

        return output
      })

      expect(result.records).toHaveLength(1)

      const found = await backend.neode.getFirst(Person, { name: 'Cypher' })
      expect(found).toBeDefined()
    })
  })
})
