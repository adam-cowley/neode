import { NodeEntity, Primary, Property } from '../../src/index'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class AmbientDoc {
  @Primary()
  @Property({ type: 'string' })
  did!: string

  @Property({ type: 'string' })
  title!: string
}

// ---------------------------------------------------------------------------

describe('calls inside neode.transaction() that used to bypass it (NTS-576)', () => {
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

  it('paginate, createMany, explain and cypher inside transaction() join it instead of deadlocking', async () => {
    const { neode } = backend

    const result = await neode.transaction(async () => {
      await neode.createMany(AmbientDoc, [
        { did: 'a1', title: 'one' },
        { did: 'a2', title: 'two' },
      ])

      const page = await neode.paginate(AmbientDoc, {}, { page: 1, limit: 10, order: 'did' })
      await neode.explain('MATCH (d:AmbientDoc) RETURN d')

      return page.total
    })

    // Saw its own uncommitted writes — it ran on the transaction
    expect(result).toBe(2)
  }, 10_000)

  it('rolls back bulk writes made through the ambient transaction', async () => {
    const { neode } = backend

    await expect(
      neode.transaction(async () => {
        await neode.createMany(AmbientDoc, [{ did: 'r1', title: 'rolled back' }])

        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(await neode.all(AmbientDoc)).toHaveLength(0)
  })
})
