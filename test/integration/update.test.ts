import {
  NodeEntity,
  Uuid,
  String,
  Number,
  InternalId,
  Required,
  Protected,
  Readonly,
  Hidden,
} from '../../src/decorators'
import { getModel } from '../../src/meta'
import { EntitySchema } from '../../src/meta/entity/entity-schema'
// Import the backend before the service: it initialises the module chain
// (neode.service → query.service) that query.service's own imports loop
// back into, so the service's direct import resolves a completed module
import { openBackend, TestBackend } from './support/backend'
import { UpdateService } from '../../src/services/query/update.service'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Person {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String()
  @Required()
  name: string

  @Number()
  age: number

  @String()
  @Readonly()
  species: string

  @String()
  @Protected()
  password: string

  @String()
  @Hidden()
  secret: string

  static create(name: string, age?: number): Person {
    const person = new Person()
    person.name = name
    person.species = 'human'
    person.password = 'secret-password'
    person.secret = 'hidden-secret'

    if (age !== undefined) {
      person.age = age
    }

    return person
  }
}

@NodeEntity()
class NoInternalId {
  @Uuid({ primary: true })
  id: string

  @String()
  @Required()
  name: string

  @Number()
  age: number

  static create(name: string, age?: number): NoInternalId {
    const person = new NoInternalId()
    person.name = name

    if (age !== undefined) {
      person.age = age
    }

    return person
  }
}

// ---------------------------------------------------------------------------

describe('UpdateService', () => {
  let backend: TestBackend
  let schema: EntitySchema

  beforeAll(async () => {
    backend = await openBackend()
    schema = getModel(Person)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  // Run the service in a write transaction, rolling back on failure
  const update = async <T extends object>(
    targetSchema: EntitySchema,
    entity: T,
    properties: Record<string, unknown>,
  ): Promise<unknown> =>
    backend.neode.inWriteTransaction(async (tx) => {
      try {
        const result = await new UpdateService(tx.getRunner()).update(
          targetSchema,
          entity,
          properties,
        )

        await tx.commit()

        return result
      } catch (error) {
        await tx.rollback()

        throw error
      }
    })

  it('updates the given properties', async () => {
    const saved = await backend.neode.save(Person.create('Adam', 30))

    await update(schema, saved, { name: 'Ada', age: 31 })

    const found = await backend.neode.find(Person, saved.id)

    expect(found?.name).toBe('Ada')
    expect(found?.age).toBe(31)
  })

  it('leaves protected, readonly, hidden and primary key properties untouched', async () => {
    const saved = await backend.neode.save(Person.create('Adam'))

    await update(schema, saved, {
      password: 'hacked',
      species: 'android',
      secret: 'exposed',
      id: '00000000-0000-0000-0000-000000000000',
    })

    const found = await backend.neode.find(Person, saved.id)

    expect(found?.password).toBe('secret-password')
    expect(found?.species).toBe('human')
    expect(found?.secret).toBe('hidden-secret')
    expect(found?.id).toBe(saved.id)
  })

  // NTS-487: keys not declared in the schema are ignored on update
  // (create/merge parity) instead of written to the node
  it('ignores keys that are not declared in the schema', async () => {
    const saved = await backend.neode.save(Person.create('Adam', 30))

    await update(schema, saved, { name: 'Ada', notInSchema: 'evil' })

    const found = await backend.neode.find(Person, saved.id)

    // Declared keys still update...
    expect(found?.name).toBe('Ada')

    // ...and the undeclared key never reaches the node
    const raw = await backend.neode.readCypher(
      'MATCH (p:Person { id: $id }) RETURN properties(p) AS props',
      {
        id: saved.id,
      },
    )

    const props = raw.records[0]?.get('props') as Record<string, unknown>

    expect(props.name).toBe('Ada')
    expect(props).not.toHaveProperty('notInSchema')
  })

  it('refills a required property provided as null from its stored value', async () => {
    const saved = await backend.neode.save(Person.create('Adam'))

    await update(schema, saved, { name: null })

    const found = await backend.neode.find(Person, saved.id)

    expect(found?.name).toBe('Adam')
  })

  it('refills required properties that are not provided', async () => {
    const saved = await backend.neode.save(Person.create('Adam', 30))

    await update(schema, saved, { age: 31 })

    const found = await backend.neode.find(Person, saved.id)

    expect(found?.name).toBe('Adam')
    expect(found?.age).toBe(31)
  })

  it('refills via the primary key when the entity carries no elementId', async () => {
    const saved = await backend.neode.save(Person.create('Adam'))

    // Hand-built instance: no hydrated elementId, only the primary key
    const detached = new Person()
    detached.id = saved.id
    detached.name = 'Carried'

    await update(schema, detached, { name: null })

    const found = await backend.neode.find(Person, saved.id)

    expect(found?.name).toBe('Adam')
  })

  it('matches by elementId on a model without @InternalId', async () => {
    const noInternalIdSchema = getModel(NoInternalId)

    const saved = await backend.neode.save(NoInternalId.create('Adam', 30))

    await update(noInternalIdSchema, saved, { name: null, age: 31 })

    const found = await backend.neode.find(NoInternalId, saved.id)

    expect(found?.name).toBe('Adam')
    expect(found?.age).toBe(31)
  })

  it('resolves cleanly when no node matches', async () => {
    const saved = await backend.neode.save(Person.create('Adam'))

    const ghost = new Person()
    ghost.id = 'no-such-id'
    ghost.name = 'Ghost'

    const result = (await update(schema, ghost, { name: 'Nobody' })) as { records: unknown[] }

    expect(result.records).toHaveLength(0)

    const found = await backend.neode.find(Person, saved.id)

    expect(found?.name).toBe('Adam')
  })

  it('keeps the uuid primary identity stable across updates', async () => {
    const saved = await backend.neode.save(Person.create('Adam'))

    await update(schema, saved, { name: 'Ada' })
    await update(schema, saved, { age: 31 })

    const found = await backend.neode.find(Person, saved.id)

    expect(found?.id).toBe(saved.id)
    expect(found?._id).toBe(saved._id)
  })

  it('throws when the primary key value is undefined', async () => {
    const orphan = new Person()
    orphan.name = 'NoId'

    await expect(update(schema, orphan, { name: 'Nobody' })).rejects.toThrow(/primary key/i)
  })
})
