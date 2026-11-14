// NTS-642 — facade methods inside the MANAGED inWriteTransaction() /
// inReadTransaction() join the unit's transaction instead of autocommitting
// around it (the embedded Relate engine deadlocked on its single
// transaction slot; Bolt silently ran the statements OUTSIDE the
// transaction). The managed units now bind the same ambient scope
// `transaction()` does (NTS-156) — with `retries: 0` (the managed API
// never retries).
import { NodeEntity, Primary, Property } from '../../src/index'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class ManagedDoc {
  @Primary()
  @Property({ type: 'string' })
  did!: string

  @Property({ type: 'string' })
  title!: string
}

// ---------------------------------------------------------------------------

describe('facade methods inside the managed inWriteTransaction join it (NTS-642)', () => {
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

  it('facade reads and writes inside inWriteTransaction run on the unit transaction', async () => {
    const { neode } = backend

    const result = await neode.inWriteTransaction(async (tx) => {
      // Facade write: joins the unit (used to autocommit around it —
      // deadlocking the embedded engine's single transaction slot)
      await neode.create(ManagedDoc, { did: 'm1', title: 'inside' })

      // Facade read: sees its own uncommitted write — proof it joined
      const seen = await neode.readCypher('MATCH (d:ManagedDoc) RETURN count(d) AS c')

      return {
        inside: Number(seen.records[0].get('c')),
        viaScope: await tx.readCypher('RETURN 1 AS n'),
      }
    })

    expect(result.inside).toBe(1)
    expect(result.viaScope.records.length).toBe(1)

    // The unit committed: the joined write persisted
    expect(await neode.all(ManagedDoc)).toHaveLength(1)
  }, 10_000)

  it('facade reads inside inReadTransaction join the unit', async () => {
    const { neode } = backend

    await neode.create(ManagedDoc, { did: 'r1', title: 'seed' })

    const count = await neode.inReadTransaction(async () => {
      const seen = await neode.readCypher('MATCH (d:ManagedDoc) RETURN count(d) AS c')

      return Number(seen.records[0].get('c'))
    })

    expect(count).toBe(1)
  }, 10_000)

  it('a failing work body rolls back the facade writes made in the callback', async () => {
    const { neode } = backend

    await expect(
      neode.inWriteTransaction(async () => {
        await neode.create(ManagedDoc, { did: 'boom', title: 'rolled back' })

        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(await neode.all(ManagedDoc)).toHaveLength(0)
  })

  it('a swallowed driver failure inside the callback fails the whole unit (NTS-589)', async () => {
    const { neode } = backend

    // A best-effort follow-up that swallows a driver failure poisons the
    // transaction — the unit refuses to commit and nothing persists
    await expect(
      neode.inWriteTransaction(async () => {
        await neode.create(ManagedDoc, { did: 'keep', title: 'before the failure' })

        try {
          await neode.writeCypher('THIS IS NOT CYPHER')
        } catch {
          // swallowed — the poison marker must survive the swallow
        }
      }),
    ).rejects.toThrow()

    expect(await neode.all(ManagedDoc)).toHaveLength(0)
  }, 10_000)

  it('a swallowed NESTED unit failure refuses the commit with the rollback-only error (NTS-589)', async () => {
    const { neode } = backend

    await expect(
      neode.inWriteTransaction(async () => {
        await neode.create(ManagedDoc, { did: 'outer', title: 'outer write' })

        // The nested unit joins the outer transaction; its failure marks
        // the shared transaction rollback-only…
        try {
          await neode.inWriteTransaction(async () => {
            await neode.writeCypher('THIS IS NOT CYPHER')
          })
        } catch {
          // …and the outer callback swallows it
        }
      }),
    ).rejects.toThrow(/rollback-only/)

    expect(await neode.all(ManagedDoc)).toHaveLength(0)
  }, 10_000)
})
