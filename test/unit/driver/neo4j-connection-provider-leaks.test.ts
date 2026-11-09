import type { Driver } from 'neo4j-driver'
import { Neo4jConnectionProvider } from '../../../src/driver/neo4j-connection-provider'

// NTS-576: the Bolt provider must close every session it opens, on every
// path, and a failing close() must never mask the real outcome.

interface FakeTx {
  run: ReturnType<typeof vi.fn>
  commit: ReturnType<typeof vi.fn>
  rollback: ReturnType<typeof vi.fn>
}

function fakeDriver(
  options: { tx?: Partial<FakeTx>; beginError?: Error; closeError?: Error } = {},
) {
  const tx: FakeTx = {
    run: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    ...options.tx,
  }

  const session = {
    run: vi.fn().mockResolvedValue({
      records: [],
      summary: { counters: { updates: () => ({}) }, plan: undefined, profile: undefined },
    }),
    beginTransaction: vi.fn(() => {
      if (options.beginError) {
        throw options.beginError
      }

      return tx
    }),
    close: vi.fn(async () => {
      if (options.closeError) {
        throw options.closeError
      }
    }),
  }

  const driver = { session: vi.fn(() => session) } as unknown as Driver

  return { driver, session, tx }
}

describe('Neo4jConnectionProvider session hygiene (NTS-576)', () => {
  it('closes the session when commit fails, and surfaces the commit error', async () => {
    const { driver, session } = fakeDriver({
      tx: { commit: vi.fn().mockRejectedValue(new Error('commit failed')) },
    })

    const handle = await new Neo4jConnectionProvider(driver).beginTransaction()

    await expect(handle.commit()).rejects.toThrow('commit failed')
    expect(session.close).toHaveBeenCalledTimes(1)
  })

  it('closes the session when rollback fails, and surfaces the rollback error', async () => {
    const { driver, session } = fakeDriver({
      tx: { rollback: vi.fn().mockRejectedValue(new Error('rollback failed')) },
    })

    const handle = await new Neo4jConnectionProvider(driver).beginTransaction()

    await expect(handle.rollback()).rejects.toThrow('rollback failed')
    expect(session.close).toHaveBeenCalledTimes(1)
  })

  it('closes the session when beginTransaction throws', async () => {
    const { driver, session } = fakeDriver({ beginError: new Error('begin failed') })

    await expect(new Neo4jConnectionProvider(driver).beginTransaction()).rejects.toThrow(
      'begin failed',
    )
    expect(session.close).toHaveBeenCalledTimes(1)
  })

  it('does not let a failing close() mask a successful commit', async () => {
    const { driver, session } = fakeDriver({ closeError: new Error('close failed') })

    const handle = await new Neo4jConnectionProvider(driver).beginTransaction()

    await expect(handle.commit()).resolves.toBeUndefined()
    expect(session.close).toHaveBeenCalledTimes(1)
  })

  it('does not let a failing close() replace the commit error', async () => {
    const { driver } = fakeDriver({
      closeError: new Error('close failed'),
      tx: { commit: vi.fn().mockRejectedValue(new Error('commit failed')) },
    })

    const handle = await new Neo4jConnectionProvider(driver).beginTransaction()

    await expect(handle.commit()).rejects.toThrow('commit failed')
  })

  it('does not let a failing close() mask a successful run() result', async () => {
    const { driver, session } = fakeDriver({ closeError: new Error('close failed') })

    const output = await new Neo4jConnectionProvider(driver).run('RETURN 1')

    expect(output.records).toEqual([])
    expect(session.close).toHaveBeenCalledTimes(1)
  })
})
