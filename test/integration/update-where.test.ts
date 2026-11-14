import { NodeEntity, Uuid, String, Number, InternalId, Version } from '../../src/decorators'
import { getModel } from '../../src/meta'
import { EntitySchema } from '../../src/meta/entity/entity-schema'
// Import the backend before the service: it initialises the module chain
// (neode.service → query.service) that query.service's own imports loop
// back into, so the service's direct import resolves a completed module
import { openBackend, TestBackend } from './support/backend'
import { UpdateService } from '../../src/services/query/update.service'
import { OptimisticLockError } from '../../src/errors'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Enrolment {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String()
  status: string

  @Number()
  percentage: number

  static create(status: string): Enrolment {
    const enrolment = new Enrolment()
    enrolment.status = status
    enrolment.percentage = 0

    return enrolment
  }
}

@NodeEntity()
class VersionedDoc {
  @Uuid({ primary: true })
  id: string

  @String()
  title: string

  @Number()
  @Version()
  version: number

  static create(title: string): VersionedDoc {
    const doc = new VersionedDoc()
    doc.title = title

    return doc
  }
}

// ---------------------------------------------------------------------------

describe('UpdateService guard / updateWhere (NTS-688)', () => {
  let backend: TestBackend
  let schema: EntitySchema

  beforeAll(async () => {
    backend = await openBackend()
    schema = getModel(Enrolment)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  const updateGuarded = async (
    entity: object,
    properties: Record<string, unknown>,
    guard?: { where: string; params?: Record<string, unknown> },
  ): Promise<unknown> =>
    backend.neode.inWriteTransaction(async (tx) => {
      try {
        const result = await new UpdateService(tx.getRunner()).update(
          schema,
          entity,
          properties,
          guard,
        )

        await tx.commit()

        return result
      } catch (error) {
        await tx.rollback()

        throw error
      }
    })

  it('writes when the guard holds, returning the matched row', async () => {
    const saved = await backend.neode.save(Enrolment.create('active'))

    const output = (await updateGuarded(
      saved,
      { percentage: 50 },
      {
        where: 'this.status = $status',
        params: { status: 'active' },
      },
    )) as { records: unknown[] }

    expect(output.records).toHaveLength(1)

    const found = await backend.neode.find(Enrolment, saved.id)
    expect(found?.percentage).toBe(50)
  })

  it('writes nothing and returns zero rows when the guard fails', async () => {
    const saved = await backend.neode.save(Enrolment.create('active'))

    const output = (await updateGuarded(
      saved,
      { percentage: 50 },
      {
        where: 'this.status = $status',
        params: { status: 'completed' },
      },
    )) as { records: unknown[] }

    expect(output.records).toHaveLength(0)

    const found = await backend.neode.find(Enrolment, saved.id)
    expect(found?.percentage).toBe(0)
  })

  it('composes the guard with the version check — a stale version throws OptimisticLockError', async () => {
    const doc = await backend.neode.save(VersionedDoc.create('Test doc'))

    // Hydrate a second instance of the same node, bump it — the first
    // instance's version is now stale
    const other = await backend.neode.find(VersionedDoc, doc.id)
    await other?.update({ title: 'Concurrent write' })

    await expect(
      backend.neode.updateWhere(doc, { where: 'this.title <> "no"' }, { title: 'Lost update' }),
    ).rejects.toThrow(OptimisticLockError)
  })

  it('facade updateWhere — resolves the updated entity when the guard holds', async () => {
    const saved = await backend.neode.save(Enrolment.create('active'))

    const updated = await backend.neode.updateWhere(
      saved,
      { where: 'this.status = $status', params: { status: 'active' } },
      { percentage: 99 },
    )

    expect(updated?.percentage).toBe(99)
    expect(updated?.status).toBe('active')
  })

  it('facade updateWhere — resolves undefined and writes nothing when the guard fails', async () => {
    const saved = await backend.neode.save(Enrolment.create('active'))

    const updated = await backend.neode.updateWhere(
      saved,
      { where: 'this.status = $status', params: { status: 'completed' } },
      { percentage: 99 },
    )

    expect(updated).toBeUndefined()

    const found = await backend.neode.find(Enrolment, saved.id)
    expect(found?.percentage).toBe(0)
  })

  it('TransactionalService updateWhere — mirror inside a transaction scope', async () => {
    const saved = await backend.neode.save(Enrolment.create('active'))

    const outcome = await backend.neode.inWriteTransaction(async (tx) => {
      const inScope = await tx.updateWhere(
        saved,
        { where: 'this.status = $status', params: { status: 'active' } },
        { percentage: 42 },
      )

      await tx.commit()

      return inScope
    })

    expect(outcome?.percentage).toBe(42)
  })
})
