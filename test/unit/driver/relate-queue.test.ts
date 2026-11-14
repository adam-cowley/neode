import { RelateConnectionProvider, requireRelateClient } from '../../../src/driver/relate'
import { Neode } from '../../../src/neode.service'

// NTS-576: the embedded provider's single transaction slot must be freed on
// every failure path, and waiting for it must be bounded.

function relateAvailable(): boolean {
  try {
    requireRelateClient()

    return true
  } catch {
    return false
  }
}

function fakeDatabase(
  overrides: { begin?: () => void; commit?: () => string | null; rollback?: () => void } = {},
) {
  const connection = {
    queryAsync: vi.fn().mockResolvedValue({ columns: [], rows: [], stats: {} }),
    query: vi.fn(),
    begin: vi.fn(overrides.begin ?? (() => undefined)),
    commit: vi.fn(overrides.commit ?? (() => null)),
    rollback: vi.fn(overrides.rollback ?? (() => undefined)),
  }

  return { database: { connect: () => connection, checkpoint: vi.fn() }, connection }
}

describe.skipIf(!relateAvailable())('RelateConnectionProvider queue (NTS-576)', () => {
  it('frees the slot when commit throws, so the next query proceeds', async () => {
    const { database, connection } = fakeDatabase({
      commit: () => {
        throw new Error('commit failed')
      },
    })

    const provider = new RelateConnectionProvider(database)
    const tx = await provider.beginTransaction()

    await expect(tx.commit()).rejects.toThrow('commit failed')
    await expect(provider.run('RETURN 1')).resolves.toBeDefined()
    expect(connection.queryAsync).toHaveBeenCalledTimes(1)
  })

  it('frees the slot when rollback throws', async () => {
    const { database } = fakeDatabase({
      rollback: () => {
        throw new Error('rollback failed')
      },
    })

    const provider = new RelateConnectionProvider(database)
    const tx = await provider.beginTransaction()

    await expect(tx.rollback()).rejects.toThrow('rollback failed')
    await expect(provider.run('RETURN 1')).resolves.toBeDefined()
  })

  it('a rollback after a failed commit does not double-release or hang', async () => {
    const { database } = fakeDatabase({
      commit: () => {
        throw new Error('commit failed')
      },
    })

    const provider = new RelateConnectionProvider(database)
    const tx = await provider.beginTransaction()

    await expect(tx.commit()).rejects.toThrow('commit failed')
    await expect(tx.rollback()).resolves.toBeUndefined()
    await expect(provider.run('RETURN 1')).resolves.toBeDefined()
  })

  it('frees the slot when begin throws', async () => {
    let fail = true

    const { database } = fakeDatabase({
      begin: () => {
        if (fail) {
          throw new Error('begin failed')
        }
      },
    })

    const provider = new RelateConnectionProvider(database)

    await expect(provider.beginTransaction()).rejects.toThrow('begin failed')

    fail = false
    const tx = await provider.beginTransaction()
    await tx.commit()
  })

  it('times out waiting for a held slot with a descriptive error, keeping order', async () => {
    const { database } = fakeDatabase()
    const provider = new RelateConnectionProvider(database, 'neo4j', { queueTimeoutMs: 50 })

    const tx = await provider.beginTransaction()

    await expect(provider.run('RETURN 1')).rejects.toThrow(/neode\.transaction\(\).*does not join/s)

    // The slot is still held by tx: a fresh waiter must not jump the queue
    // when the timed-out waiter gave up — and everything proceeds after commit
    await tx.commit()
    await expect(provider.run('RETURN 1')).resolves.toBeDefined()
  })

  it('forRelate forwards queueTimeoutMs to the provider (NTS-589)', async () => {
    // NTS-589: queueTimeoutMs was only reachable by constructing
    // RelateConnectionProvider directly — forRelate now accepts it too. The
    // 25ms timeout (vs the 30000ms default) proves the option reached it.
    const { database } = fakeDatabase()
    const neode = Neode.forRelate(database, 'neo4j', false, { queueTimeoutMs: 25 })

    const tx = await neode.getConnection().beginTransaction()

    await expect(neode.getConnection().run('RETURN 1')).rejects.toThrow('Timed out after 25ms')

    await tx.commit()
    await expect(neode.getConnection().run('RETURN 1')).resolves.toBeDefined()
  })
})
