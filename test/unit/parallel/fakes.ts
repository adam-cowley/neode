import type {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams,
  TransactionHandle,
} from '../../../src/driver/types.js'

/**
A TransactionHandle that records its own fate — the atomic-mode
assertions read the committed / rolledBack flags. No database.
*/
export class FakeHandle implements TransactionHandle {
  committed = false

  rolledBack = false

  private readonly failCommit: boolean

  constructor(
    readonly id: number,
    options: { failCommit?: boolean } = {},
  ) {
    this.failCommit = options.failCommit === true
  }

  run(): Promise<QueryOutput> {
    return Promise.resolve({ records: [] })
  }

  commit(): Promise<void> {
    if (this.failCommit) {
      return Promise.reject(new Error(`commit failed for handle ${this.id}`))
    }

    this.committed = true

    return Promise.resolve()
  }

  rollback(): Promise<void> {
    this.rolledBack = true

    return Promise.resolve()
  }
}

/**
A ConnectionProvider that records routing per autocommit statement and
hands out recording handles. Tracks in-flight autocommit runs so tests
can assert the fan-out actually overlapped (sequential execution peaks
at 1; a concurrent fan-out peaks at the operation count). No database.
*/
export class FakeProvider implements ConnectionProvider {
  private readonly delayMs: number

  constructor(delayMs = 10) {
    this.delayMs = delayMs
  }

  /** Autocommit statements, [statement, routing] in call order */
  readonly autocommit: [string, AccessMode | undefined][] = []

  /** Transactions opened through this provider, in open order */
  readonly handles: FakeHandle[] = []

  /** Handle ids whose commit() rejects — the commit-phase test */
  readonly failCommitFor = new Set<number>()

  inFlight = 0

  maxInFlight = 0

  run(statement: string, _parameters?: QueryParams, mode?: AccessMode): Promise<QueryOutput> {
    this.inFlight++
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)

    return new Promise((resolve) => {
      setTimeout(() => {
        this.inFlight--
        this.autocommit.push([statement, mode])

        resolve({ records: [] })
      }, this.delayMs)
    })
  }

  beginTransaction(): Promise<TransactionHandle> {
    const id = this.handles.length
    const handle = new FakeHandle(id, { failCommit: this.failCommitFor.has(id) })

    this.handles.push(handle)

    return Promise.resolve(handle)
  }

  edition(): Promise<'enterprise' | 'community' | 'unknown'> {
    return Promise.resolve('community')
  }

  close(): Promise<void> {
    return Promise.resolve()
  }
}
