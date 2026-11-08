/**
Ambient transactions (NTS-156): the open transaction lives in an
AsyncLocalStorage scope for the duration of a `neode.transaction()`
callback, so every facade/repository call inside joins it without
threading a handle.

Availability contract: this module imports `node:async_hooks`, so the
ambient API needs a runtime with AsyncLocalStorage (Node.js; workerd's
node:async_hooks compatibility also qualifies). On runtimes without it
(some edge/serverless targets) keep using the explicit-handle API —
`readTransaction()` / `writeTransaction()`,
`openReadTransaction()` / `openWriteTransaction()` and the managed
`inReadTransaction()` / `inWriteTransaction()` — which never touches ALS.
*/
import type { EventEmitter } from 'node:events'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { AccessMode, TransactionHandle } from '../driver/types.js'
import { classifyError, isTransientError, NeodeError } from '../errors/index.js'
import { rollbackAfterFailure } from './rollback.js'
import { TransactionalService } from './transactional.service.js'

/**
Options for `Neode#transaction` — routing and database are per
transaction (the transaction's session decides them once at open time).
*/
export interface TransactionOptions {
  /**
  Routing of the transaction's session: 'WRITE' (default, primaries) or
  'READ' (replica-capable). Statements inside the transaction do not
  re-route — the mode the transaction opened with decides.
  */
  routing?: AccessMode

  /**
  Database the transaction opens against (multi-database backends).
  A transaction is bound to one database at open time; per-call database
  overrides inside the callback are ignored.
  */
  database?: string

  /**
  Retries after the first attempt when the failure classifies as
  transient (TransientError — `Neo.TransientError.*` codes or a driver
  `retryable` verdict). Default 2.
  */
  retries?: number
}

/**
One transaction attempt: the real handle plus the join handle every
joined call runs on.
*/
export class AmbientTransactionScope {
  private readonly joinHandle: TransactionHandle

  /**
  The real transaction — only the outermost unit commits or rolls it back.
  */
  readonly handle: TransactionHandle

  /**
  Set when a join failed (or explicitly rolled back): the transaction must
  not commit, even when the callback swallows the error. Checked by the
  outermost unit before its commit.
  */
  rollbackOnly = false

  constructor(handle: TransactionHandle) {
    this.handle = handle

    // The handle every joined call runs on: statements execute in the
    // ambient transaction, while the close endpoints defer to the
    // outermost unit — a per-method commit()/rollback() (every facade
    // method closes its own scope) must never close the shared transaction
    this.joinHandle = {
      run: async (statement, parameters) => this.handle.run(statement, parameters),
      commit: async () => {
        // Nothing to do — deferred by design: the outermost unit commits
        // the shared transaction
      },
      // eslint-disable-next-line @typescript-eslint/require-await -- deferred by design: a joined rollback marks the scope rollback-only, the outermost unit rolls the shared transaction back
      rollback: async () => {
        this.rollbackOnly = true
      },
    }
  }

  /**
  The handle joined calls run on.
  */
  get runner(): TransactionHandle {
    return this.joinHandle
  }

  /**
  Run work joined to this scope: same transaction, close endpoints
  deferred. A failure marks the scope rollback-only on the way out, so an
  error that the caller handles inside the callback still prevents the
  commit.
  */
  async join<T>(
    eventEmitter: EventEmitter,
    work: (tx: TransactionalService) => Promise<T>,
  ): Promise<T> {
    try {
      return await work(new TransactionalService(this.joinHandle, eventEmitter))
    } catch (error) {
      this.rollbackOnly = true

      throw error
    }
  }
}

const storage = new AsyncLocalStorage<AmbientTransactionScope>()

/**
The open ambient transaction, if the calling async context has one.
*/
export function ambientTransaction(): AmbientTransactionScope | undefined {
  return storage.getStore()
}

/**
Run the work with the scope bound as the ambient transaction.
*/
async function runWithAmbientTransaction<T>(
  scope: AmbientTransactionScope,
  work: () => Promise<T>,
): Promise<T> {
  return storage.run(scope, work)
}

/**
Backoff between transient retries: linear, one delay per failed attempt.
*/
const TRANSIENT_RETRY_DELAY_MS = 100

/**
Retries after the first attempt, by default.
*/
const DEFAULT_RETRIES = 2

/**
Run an ambient transaction unit: open a transaction, bind it as the
ambient scope for the work, commit on success / roll back on failure
(NTS-561 close semantics), and retry the whole unit in a fresh
transaction when the failure classifies as transient.
*/
export async function runAmbientTransaction<T>(
  begin: () => Promise<TransactionHandle>,
  eventEmitter: EventEmitter,
  work: (tx: TransactionalService) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const maxAttempts = 1 + Math.max(0, options.retries ?? DEFAULT_RETRIES)

  for (let attempt = 1; ; attempt++) {
    // Begin failures are not retried: session acquisition is local — the
    // real transient windows (statement execution, commit) are below
    const handle = await begin()
    const scope = new AmbientTransactionScope(handle)
    const tx = new TransactionalService(handle, eventEmitter)

    let result: T

    try {
      result = await runWithAmbientTransaction(scope, async () => work(tx))
    } catch (error) {
      // The work closed the transaction explicitly and threw afterwards —
      // the terminal operation stands, rethrow untouched (NTS-561)
      if (tx.isSettled()) {
        throw error
      }

      // rollbackAfterFailure rolls the attempt back and rethrows the
      // original error (a failing rollback is warned and chained, never
      // swallowed) — catch the rethrow to make the retry decision
      let original: unknown

      try {
        await rollbackAfterFailure(handle, error)
      } catch (error_) {
        original = error_
      }

      // Managed transient retry: the WHOLE callback re-runs in a fresh
      // transaction, so the callback must be idempotent — work that
      // reached the database rolled back, but non-database side effects
      // do not
      const classified = classifyError(original)

      if (isTransientError(classified) && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS * attempt))

        continue
      }

      throw classified
    }

    if (!tx.isSettled()) {
      // The work resolved, but a joined call failed (or rolled back) and
      // its error was handled inside the callback — the transaction must
      // not commit
      if (scope.rollbackOnly) {
        return await rollbackAfterFailure(
          handle,
          new NeodeError(
            'The transaction was marked rollback-only by a failed nested operation whose error was handled inside the callback — nothing was committed. Rethrow (or return a failure) inside the transaction callback to surface the original error.',
          ),
        )
      }

      try {
        await tx.commit()
      } catch (error) {
        // The commit can fail transiently too (network drop at commit) —
        // retry the unit in a fresh transaction; the idempotency contract
        // covers the work already re-running
        const classified = classifyError(error)

        if (isTransientError(classified) && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS * attempt))

          continue
        }

        throw classified
      }
    }

    return result
  }
}
