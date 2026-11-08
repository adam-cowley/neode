// NTS-156 — ambient transactions: `neode.transaction()` binds the open
// transaction to AsyncLocalStorage for the duration of the callback, so
// facade/repository calls inside join it without threading a handle.
//
// Proves the four behaviours the issue names: join, rollback on throw,
// retry on a simulated transient error, and no context leak between
// concurrent async flows.
import { NodeEntity, Primary, Property } from '../../src/decorators'
import type {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams,
  TransactionHandle,
} from '../../src/driver/types.js'
import { Neode } from '../../src/neode.service'
import { testId } from '../../src/testing/index.js'
import { openBackend, type TestBackend } from './support/backend'

// ---- Fixtures (per-file: the decorator registry is global per module registry) --

@NodeEntity()
class AmbientPerson {
  @Primary()
  @Property({ type: 'string' })
  name!: string
}

// A provider that counts beginTransaction calls (and records their
// arguments) — the join proof: a whole flow of facade calls inside one
// ambient transaction must open exactly ONE transaction
class CountingProvider implements ConnectionProvider {
  begins = 0
  modes: AccessMode[] = []
  databases: (string | undefined)[] = []

  constructor(private readonly inner: ConnectionProvider) {}

  async run(
    statement: string,
    parameters?: QueryParams,
    mode?: AccessMode,
    database?: string,
  ): Promise<QueryOutput> {
    return this.inner.run(statement, parameters, mode, database)
  }

  async beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle> {
    this.begins++
    this.modes.push(mode ?? 'WRITE')
    this.databases.push(database)

    return this.inner.beginTransaction(mode, database)
  }

  async edition(): Promise<'enterprise' | 'community' | 'unknown'> {
    return this.inner.edition()
  }

  async close(): Promise<void> {
    await this.inner.close()
  }
}

// A provider whose FIRST statement run throws a transient-classified
// failure (`Neo.TransientError.*` code) before reaching the database —
// the simulated transient error for the retry proof
class TransientOnceProvider extends CountingProvider {
  private statementFailed = false

  async beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle> {
    const handle = await super.beginTransaction(mode, database)

    return {
      run: async (statement: string, parameters?: QueryParams) => {
        if (!this.statementFailed) {
          this.statementFailed = true

          throw Object.assign(new Error('Simulated transient failure'), {
            code: 'Neo.TransientError.NetworkError',
          })
        }

        return handle.run(statement, parameters)
      },
      commit: () => handle.commit(),
      rollback: () => handle.rollback(),
    }
  }
}

// A provider that records the beginTransaction arguments and hands back
// inert handles — the routing/database wiring check runs against NO real
// database, so it passes on every backend
class StubProvider implements ConnectionProvider {
  modes: AccessMode[] = []
  databases: (string | undefined)[] = []

  async run(): Promise<QueryOutput> {
    throw new Error('not expected')
  }

  async beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle> {
    this.modes.push(mode ?? 'WRITE')
    this.databases.push(database)

    return {
      run: async () => {
        throw new Error('not expected')
      },
      commit: async () => {},
      rollback: async () => {},
    }
  }

  async edition(): Promise<'enterprise' | 'community' | 'unknown'> {
    return 'unknown'
  }

  async close(): Promise<void> {}
}

const countByName = async (neode: Neode, name: string): Promise<number> => {
  const found = await neode.all(AmbientPerson, { name })

  return found.length
}

describe('ambient transactions — integration', () => {
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

  it('facade calls inside transaction() join the ambient transaction', async () => {
    const counting = new CountingProvider(backend.connection)
    const scoped = new Neode(counting)
    const name = testId('ambient-join')

    const inside = await scoped.transaction(async (tx) => {
      // A facade WRITE joins the ambient transaction...
      await scoped.create(AmbientPerson, { name })

      // ...so a read through the SAME transaction sees it uncommitted
      return tx.find(AmbientPerson, name)
    })

    expect(inside).toBeDefined()

    // Exactly one transaction was opened for the whole flow: the facade
    // create() joined instead of opening its own
    expect(counting.begins).toBe(1)

    // The ambient transaction committed on success
    expect(await countByName(backend.neode, name)).toBe(1)
  })

  it('a throw rolls the ambient transaction back', async () => {
    const name = testId('ambient-rollback')

    await expect(
      backend.neode.transaction(async () => {
        await backend.neode.create(AmbientPerson, { name })

        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(await countByName(backend.neode, name)).toBe(0)
  })

  it('a transient failure retries the whole callback in a fresh transaction', async () => {
    const provider = new TransientOnceProvider(backend.connection)
    const flaky = new Neode(provider)
    const name = testId('ambient-retry')
    let workRuns = 0

    await flaky.transaction(async (tx) => {
      workRuns++

      await tx.writeCypher('CREATE (:AmbientPerson { name: $name })', { name })
    })

    // The callback re-ran in a fresh transaction (two begins), and the
    // failed attempt left nothing behind — the node exists exactly once
    expect(workRuns).toBe(2)
    expect(provider.begins).toBe(2)
    expect(await countByName(backend.neode, name)).toBe(1)
  })

  it('a non-transient failure does not retry', async () => {
    const counting = new CountingProvider(backend.connection)
    const scoped = new Neode(counting)

    await expect(
      scoped.transaction(async () => {
        throw new Error('plain failure')
      }),
    ).rejects.toThrow('plain failure')

    expect(counting.begins).toBe(1)
  })

  it('a transient COMMIT failure retries the whole callback', async () => {
    // A provider whose first commit throws a transient failure (after
    // aborting the attempt's transaction, as the engines do on a failed
    // commit) and whose second commit succeeds
    class TransientCommitOnceProvider extends CountingProvider {
      private commitFailed = false

      async beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle> {
        const handle = await super.beginTransaction(mode, database)

        return {
          run: (statement: string, parameters?: QueryParams) => handle.run(statement, parameters),
          commit: async () => {
            if (!this.commitFailed) {
              this.commitFailed = true

              await handle.rollback()

              throw Object.assign(new Error('Simulated transient commit failure'), {
                code: 'Neo.TransientError.NetworkError',
              })
            }

            await handle.commit()
          },
          rollback: () => handle.rollback(),
        }
      }
    }

    const provider = new TransientCommitOnceProvider(backend.connection)
    const flaky = new Neode(provider)
    const name = testId('ambient-commit-retry')
    let workRuns = 0

    await flaky.transaction(async (tx) => {
      workRuns++

      await tx.writeCypher('CREATE (:AmbientPerson { name: $name })', { name })
    })

    expect(workRuns).toBe(2)
    expect(provider.begins).toBe(2)
    expect(await countByName(backend.neode, name)).toBe(1)
  })

  it('retry attempts are bounded', async () => {
    // A provider whose EVERY statement run fails transiently
    class AlwaysTransientProvider extends CountingProvider {
      async beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle> {
        const handle = await super.beginTransaction(mode, database)

        return {
          run: async () => {
            throw Object.assign(new Error('Simulated transient failure'), {
              code: 'Neo.TransientError.NetworkError',
            })
          },
          commit: () => handle.commit(),
          rollback: () => handle.rollback(),
        }
      }
    }

    const provider = new AlwaysTransientProvider(backend.connection)
    const flaky = new Neode(provider)

    await expect(
      flaky.transaction(async (tx) => {
        await tx.writeCypher('RETURN 1')
      }),
    ).rejects.toThrow('Simulated transient failure')

    // 1 first attempt + 2 default retries
    expect(provider.begins).toBe(3)
  })

  it('concurrent async flows do not leak context', async () => {
    const counting = new CountingProvider(backend.connection)
    const scoped = new Neode(counting)
    const nameA = testId('ambient-flow-a')
    const nameB = testId('ambient-flow-b')

    // Two concurrent ambient transactions: each nested transaction() call
    // must join its OWN outer scope (the per-scope join handle identifies
    // it), and each flow's writes must stay in its own transaction
    const [flowA, flowB] = await Promise.all([
      scoped.transaction(async () => {
        await scoped.create(AmbientPerson, { name: nameA })

        return { runner: scoped.transaction((tx) => tx.getRunner()), name: nameA }
      }),
      scoped.transaction(async () => {
        await scoped.create(AmbientPerson, { name: nameB })

        return { runner: scoped.transaction((tx) => tx.getRunner()), name: nameB }
      }),
    ])

    // Each flow opened exactly one transaction — no join leaked into the
    // other flow (which would either skip the begin or deadlock the
    // serialised embedded engine)
    expect(counting.begins).toBe(2)
    expect(flowA.runner).not.toBe(flowB.runner)

    // Both flows committed independently
    expect(await countByName(backend.neode, flowA.name)).toBe(1)
    expect(await countByName(backend.neode, flowB.name)).toBe(1)

    // The context does not dangle: a transaction started AFTER the flows
    // settle opens a fresh transaction
    await scoped.transaction(async () => null)
    expect(counting.begins).toBe(3)
  })

  it('routing and database are per transaction', async () => {
    const stub = new StubProvider()
    const scoped = new Neode(stub)

    await scoped.transaction(async () => null, { routing: 'READ', database: 'ambient-probe' })

    expect(stub.modes).toEqual(['READ'])
    expect(stub.databases).toEqual(['ambient-probe'])

    // Default routing is WRITE, default database is the instance's
    await scoped.transaction(async () => null)
    expect(stub.modes).toEqual(['READ', 'WRITE'])
  })

  it('a swallowed nested failure marks the transaction rollback-only', async () => {
    const name = testId('ambient-swallowed')

    await expect(
      backend.neode.transaction(async () => {
        await backend.neode.create(AmbientPerson, { name })

        // A nested facade call fails — its joined scope marks the
        // transaction rollback-only — and the callback swallows the error
        try {
          await backend.neode.batch(['THIS IS NOT CYPHER'])
        } catch {
          // handled — the transaction still must not commit
        }

        return null
      }),
    ).rejects.toThrow('rollback-only')

    expect(await countByName(backend.neode, name)).toBe(0)
  })

  it('repository calls join the ambient transaction', async () => {
    const counting = new CountingProvider(backend.connection)
    const scoped = new Neode(counting)
    const name = testId('ambient-repository')

    await scoped.transaction(async () => {
      const repository = scoped.getRepository(AmbientPerson)

      const entity = new AmbientPerson()
      entity.name = name

      const saved = await repository.save(entity)

      expect(saved.name).toBe(name)
    })

    // The repository save ran in the ambient transaction (one begin) and
    // committed with it
    expect(counting.begins).toBe(1)
    expect(await countByName(backend.neode, name)).toBe(1)
  })
})
