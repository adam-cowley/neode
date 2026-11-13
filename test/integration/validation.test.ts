import { NodeEntity, Uuid, String, InternalId } from '../../src/decorators'
import { getModel } from '../../src/meta'
import { defineModel } from '../../src/meta/map-schema'
import { validate } from '../../src/validation'
import { ValidationError } from '../../src/validation/validation-error'
// Import the backend before the service: it initialises the module chain
// (neode.service → query.service) that query.service's own imports loop
// back into, so the service's direct import resolves a completed module
import { openBackend, TestBackend } from './support/backend'
import { UpdateService } from '../../src/services/query/update.service'
import { MergeService } from '../../src/services/query/merge.service'
import { EntitySchema } from '../../src/meta/entity/entity-schema'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class ValidatedPerson {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  name: string

  @String({ email: true })
  email: string

  static create(name: string, email: string): ValidatedPerson {
    const person = new ValidatedPerson()
    person.name = name
    person.email = email

    return person
  }
}

// ----------------------------------------------------------------------------

describe('validation wired into the write paths', () => {
  let backend: TestBackend
  let schema: EntitySchema

  beforeAll(async () => {
    backend = await openBackend()
    schema = getModel(ValidatedPerson)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  // Run a save in a write transaction, rolling back on failure — neode.save
  // has no rollback on error, and a thrown save would poison the shared
  // connection for the tests after it
  const save = (entity: object, targetSchema: EntitySchema = schema): Promise<unknown> =>
    backend.neode.inWriteTransaction(async (tx) => {
      try {
        const result = await new MergeService(tx.getRunner()).save(entity, targetSchema)

        await tx.commit()

        return result
      } catch (error) {
        await tx.rollback()

        throw error
      }
    })

  // Run the update in a write transaction, rolling back on failure
  const update = async (entity: object, properties: Record<string, unknown>): Promise<unknown> =>
    backend.neode.inWriteTransaction(async (tx) => {
      try {
        const result = await new UpdateService(tx.getRunner()).update(schema, entity, properties)

        await tx.commit()

        return result
      } catch (error) {
        await tx.rollback()

        throw error
      }
    })

  it('rejects a save with an invalid value (decorator model)', async () => {
    const promise = save(ValidatedPerson.create('Adam', 'not-an-email'))

    await expect(promise).rejects.toThrow(ValidationError)
    await expect(promise).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ['email'], rule: 'email' })],
    })
  })

  it('saves a valid value (decorator model) and round-trips it', async () => {
    const saved = await backend.neode.save(ValidatedPerson.create('Adam', 'adam@example.com'))

    const found = await backend.neode.find(ValidatedPerson, saved.id)

    expect(found?.email).toBe('adam@example.com')
  })

  it('rejects an invalid update value and leaves the node unchanged', async () => {
    const saved = await backend.neode.save(ValidatedPerson.create('Adam', 'adam@example.com'))

    await expect(update(saved, { email: 'not-an-email' })).rejects.toThrow(ValidationError)

    const found = await backend.neode.find(ValidatedPerson, saved.id)

    expect(found?.email).toBe('adam@example.com')
  })

  // NTS-487: validation is enforced on the TransactionalService mirror —
  // statements run inside a transaction validate their inputs like the
  // facade does, and the failure rolls the transaction back
  it('rejects an invalid tx.update value and rolls the transaction back', async () => {
    const saved = await backend.neode.save(ValidatedPerson.create('Adam', 'adam@example.com'))

    const promise = backend.neode.inWriteTransaction(async (tx) => {
      try {
        const updated = await tx.update(saved, { email: 'not-an-email' })

        await tx.commit()

        return updated
      } catch (error) {
        await tx.rollback()

        throw error
      }
    })

    await expect(promise).rejects.toThrow(ValidationError)

    const found = await backend.neode.find(ValidatedPerson, saved.id)

    expect(found?.email).toBe('adam@example.com')
  })

  it('rejects an invalid mergeOn set value', async () => {
    await expect(
      backend.neode.mergeOn(ValidatedPerson, { name: 'Adam' }, { email: 'not-an-email' }),
    ).rejects.toThrow(ValidationError)
  })

  it('rejects an invalid map-defined model value on save', async () => {
    const EmailUser = defineModel('ValidatedMapEmailUser', {
      id: { type: 'uuid', primary: true },
      email: { type: 'string', email: true },
    })

    const mapSchema = getModel(EmailUser)

    const bad = new EmailUser() as unknown as { email: string }
    bad.email = 'not-an-email'

    await expect(save(bad as object, mapSchema)).rejects.toThrow(ValidationError)

    const ok = new EmailUser() as unknown as { email: string }
    ok.email = 'bob@example.com'

    const saved = await backend.neode.save(ok as object)

    expect(saved.email).toBe('bob@example.com')
  })

  it('validates with the same rules through validate()', () => {
    const schema = getModel(ValidatedPerson)

    expect(() => validate({ email: 'not-an-email' }, schema)).toThrow(ValidationError)
  })
})
