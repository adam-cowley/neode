import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Runner } from '../../src/driver/types'
import { wipe } from '../../src/testing/wipe'

const record = (values: Record<string, unknown>) => ({
  get: (key: string) => values[key],
  has: (key: string) => key in values,
  keys: Object.keys(values),
})

const runnerWith = (
  handler: (statement: string) => unknown = () => [],
): Runner & { run: ReturnType<typeof vi.fn> } => ({
  run: vi.fn(async (statement: string) => {
    if (statement.startsWith('MATCH (n) RETURN count')) {
      return { records: [record({ count: 3 })] }
    }

    const rows = handler(statement)

    return { records: Array.isArray(rows) ? rows : [] }
  }),
})

describe('wipe() guards (NTS-578)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('refuses without an explicit opt-in and touches nothing', async () => {
    vi.stubEnv('NEODE_ALLOW_WIPE', '')

    const runner = runnerWith()

    await expect(wipe(runner)).rejects.toThrow(/confirm: true/)
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('accepts NEODE_ALLOW_WIPE=true as the suite-wide opt-in', async () => {
    vi.stubEnv('NEODE_ALLOW_WIPE', 'true')
    vi.stubEnv('NEO4J_URI', '')

    await expect(wipe(runnerWith())).resolves.toMatchObject({ nodesDeleted: 3 })
  })

  it('refuses a non-local uri unless allowRemote is set', async () => {
    const runner = runnerWith()

    await expect(
      wipe(runner, { confirm: true, uri: 'neo4j+s://abc.databases.neo4j.io' }),
    ).rejects.toThrow(/allowRemote: true/)
    expect(runner.run).not.toHaveBeenCalled()

    await expect(
      wipe(runner, { confirm: true, uri: 'neo4j+s://abc.databases.neo4j.io', allowRemote: true }),
    ).resolves.toBeDefined()
    await expect(
      wipe(runner, { confirm: true, uri: 'bolt://localhost:7687' }),
    ).resolves.toBeDefined()
    await expect(
      wipe(runner, { confirm: true, uri: 'bolt://user:pw@127.0.0.1:7687' }),
    ).resolves.toBeDefined()
  })

  it('refuses when the connected database does not match `database`', async () => {
    const runner = runnerWith((statement) =>
      statement.startsWith('CALL db.info') ? [record({ name: 'neo4j' })] : [],
    )

    await expect(wipe(runner, { confirm: true, database: 'prod' })).rejects.toThrow(
      /expected database "prod"/,
    )
    await expect(wipe(runner, { confirm: true, database: 'neo4j' })).resolves.toBeDefined()
  })

  it('batches the delete with CALL IN TRANSACTIONS and reports what it dropped', async () => {
    const runner = runnerWith((statement) => {
      if (statement === 'SHOW CONSTRAINTS') return [record({ name: 'c1' })]
      if (statement === 'SHOW INDEXES')
        return [record({ name: 'i1', type: 'RANGE' }), record({ name: 'look', type: 'LOOKUP' })]
      return []
    })

    const report = await wipe(runner, { confirm: true, batchSize: 50 })

    expect(runner.run.mock.calls.map((call) => call[0])).toContain(
      'MATCH (n) CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 50 ROWS',
    )
    expect(report).toMatchObject({
      nodesDeleted: 3,
      deleteStrategy: 'in-transactions',
      wasGraphTypeReset: true,
      constraintsDropped: ['c1'],
      indexesDropped: ['i1'],
      failed: [],
    })
  })

  it('falls back to a LIMIT loop when CALL IN TRANSACTIONS is unsupported', async () => {
    let deletes = 0
    const runner: Runner = {
      run: vi.fn(async (statement: string) => {
        if (statement.startsWith('MATCH (n) RETURN count'))
          return { records: [record({ count: 3 })] }
        if (statement.includes('IN TRANSACTIONS')) throw new Error('Invalid input: IN TRANSACTIONS')
        if (statement.includes('RETURN count(*) AS deleted')) {
          deletes += 1
          return { records: [record({ deleted: deletes === 1 ? 3 : 0 })] }
        }
        return { records: [] }
      }),
    }

    const report = await wipe(runner, { confirm: true })

    expect(report.deleteStrategy).toBe('limit-loop')
    expect(deletes).toBe(2)
  })

  it('surfaces unexpected errors instead of swallowing them, and reports failed drops', async () => {
    const authFailure: Runner = {
      run: vi.fn(async (statement: string) => {
        if (statement.startsWith('MATCH (n) RETURN count'))
          return { records: [record({ count: 0 })] }
        if (statement.includes('GRAPH TYPE'))
          throw new Error('Neo.ClientError.Security.Forbidden: not allowed')
        return { records: [] }
      }),
    }

    await expect(wipe(authFailure, { confirm: true })).rejects.toThrow(/Forbidden/)

    const stubborn = runnerWith((statement) =>
      statement === 'SHOW CONSTRAINTS' ? [record({ name: 'c1' })] : [],
    )
    stubborn.run.mockImplementation(async (statement: string) => {
      if (statement.startsWith('MATCH (n) RETURN count')) return { records: [] }
      if (statement.startsWith('DROP CONSTRAINT')) throw new Error('owned by graph type')
      return { records: statement === 'SHOW CONSTRAINTS' ? [record({ name: 'c1' })] : [] }
    })

    const report = await wipe(stubborn, { confirm: true })

    expect(report.failed).toEqual([
      { kind: 'constraint', name: 'c1', error: 'owned by graph type' },
    ])
  })
})
