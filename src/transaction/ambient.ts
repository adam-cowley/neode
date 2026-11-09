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
import type { ObserverRegistry } from '../observers.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { AccessMode, TransactionHandle } from '../driver/types.js'
import { classifyError, isRetryableError, NeodeError } from '../errors/index.js'
import { EffectBuffer } from './effects.js'
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
  A transaction is bound to one database at open time: a joined call
  passing a DIFFERENT `database` throws (NTS-589) — set `database` on the
  outermost `transaction()` instead, or run that work outside the callback.
  */
  database?: string

  /**
  Retries after the first attempt when the failure classifies as
  transient (TransientError — `Neo.TransientError.*` codes or a driver
  `retryable` verdict; a transaction terminated by an operator or the
  server timeout, `Transaction.Terminated` / `Transaction.LockClientStopped`,
  is never retried). Default 2 — NOTE: unlike `inWriteTransaction` (which
  never retries), `transaction()` re-runs the callback by default, so the
  callback must be idempotent; pass `retries: 0` to opt out.

  Failures raised while committing are NOT retried by default: a dropped
  connection during commit is ambiguous (the server may have committed),
  and re-running would apply non-idempotent work twice. Set `retryCommit`
  to opt in.
  */
  retries?: number

  /**
  Also retry a transient failure raised by the commit itself. Off by default
  (see `retries`): only enable it when the callback is safe to apply twice.
  */
  retryCommit?: boolean
}

/**
The routing / database / retry settings a scope opened with — what a joined
call is checked against.
*/
export interface AmbientSettings {
  routing: AccessMode
  database: string | undefined
  retries: number
  retryCommit: boolean
}

/**
One transaction attempt: the real handle plus the join handle every
joined call runs on.
*/
export class AmbientTransactionScope {
  private readonly joinHandle: TransactionHandle

  /**
  Set when a statement run by a joined call FAILED on the driver — a failed
  statement can leave the shared transaction rollback-only server-side (the
  driver refuses its commit), so a swallowed failure must not commit. Pure-JS
  errors never reached the driver and must not poison the scope (NTS-589).
  */
  private statementFailed = false

  /**
  The real transaction — only the outermost unit commits or rolls it back.
  */
  readonly handle: TransactionHandle

  /**
  Set when a joined call failed with a statement that reached the driver
  (or explicitly rolled back): the transaction must not commit, even when
  the callback swallows the error. Checked by the outermost unit before its
  commit. A pure-JS failure in a joined call that never reached the driver
  (validation, unknown model, …) does NOT set this — nothing was written,
  so a callback that handles the error may still commit (NTS-589).
  */
  rollbackOnly = false

  /**
  Set once the attempt finished (committed, rolled back or failed): the
  scope can no longer run statements — a call that escaped the callback
  (detached async work) must fail loudly instead of hitting a closed transaction.
  */
  closed = false

  /**
  The events / observers the attempt's writes queued — flushed after the
  commit, discarded on rollback or retry (NTS-582).
  */
  readonly effects = new EffectBuffer()

  /**
  What this scope opened with; joined calls may not conflict with it.
  */
  readonly settings: AmbientSettings

  constructor(handle: TransactionHandle, settings: AmbientSettings) {
    this.handle = handle
    this.settings = settings

    // The handle every joined call runs on: statements execute in the
    // ambient transaction, while the close endpoints defer to the
    // outermost unit — a per-method commit()/rollback() (every facade
    // method closes its own scope) must never close the shared transaction
    this.joinHandle = {
      run: async (statement, parameters) => {
        this.assertOpen()

        try {
          return await this.handle.run(statement, parameters)
        } catch (error) {
          // The failed statement is the poison case: the driver may have
          // marked the shared transaction rollback-only server-side, so a
          // callback that swallows the error still must not commit (NTS-589)
          this.statementFailed = true

          throw error
        }
      },
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
  Throw when the scope already finished — see `closed`.
  */
  assertOpen(): void {
    if (this.closed) {
      throw new NeodeError(
        'The ambient transaction already finished (detached async work?). A call ran after the transaction() callback resolved — await every promise started inside the callback (no fire-and-forget work), or run that work in its own transaction.',
      )
    }
  }

  /**
  Throw when a joined call passes an option that conflicts with the outer
  transaction. A joined call runs in the outer transaction, so its own
  routing / database / retries could only be silently dropped.
  */
  assertCompatible(
    call: string,
    options: {
      routing?: AccessMode | undefined
      database?: string | undefined
      retries?: number | undefined
      retryCommit?: boolean | undefined
    },
  ): void {
    const { settings } = this

    const conflicts: string[] = []

    if (options.routing !== undefined && options.routing !== settings.routing) {
      conflicts.push(
        `routing '${options.routing}' (the outer transaction is '${settings.routing}')`,
      )
    }

    if (options.database !== undefined && options.database !== settings.database) {
      conflicts.push(
        `database '${options.database}' (the outer transaction uses ${settings.database === undefined ? 'the default database' : `'${settings.database}'`})`,
      )
    }

    if (options.retries !== undefined && options.retries !== settings.retries) {
      conflicts.push(
        `retries ${String(options.retries)} (the outer transaction retries ${String(settings.retries)})`,
      )
    }

    if (options.retryCommit !== undefined && options.retryCommit !== settings.retryCommit) {
      conflicts.push(
        `retryCommit ${String(options.retryCommit)} (the outer transaction: ${String(settings.retryCommit)})`,
      )
    }

    if (conflicts.length > 0) {
      throw new NeodeError(
        `${call} joins the surrounding transaction, so it cannot change its options: ${conflicts.join('; ')}. Remove the option from the nested call, set it on the outermost transaction() instead, or run the work outside the callback to use a separate transaction.`,
      )
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
  deferred. The scope is marked rollback-only on the way out — but only
  once a statement of the joined call FAILED on the driver (the shared
  transaction may then be rollback-only server-side). A pure-JS failure
  before any statement (validation, unknown model, …) left the transaction
  clean, so a callback that handles the error may still commit (NTS-589).
  */
  async join<T>(
    eventEmitter: EventEmitter,
    work: (tx: TransactionalService) => Promise<T>,
    observers?: ObserverRegistry,
  ): Promise<T> {
    this.assertOpen()

    try {
      return await work(
        new TransactionalService(this.joinHandle, eventEmitter, this.effects, false, observers),
      )
    } catch (error) {
      if (this.statementFailed) {
        this.rollbackOnly = true
      }

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
Backoff between transient retries: linear, one delay per failed attempt,
with up to 50% jitter so concurrent units that deadlocked together do not
retry in lockstep (NTS-582).
*/
const TRANSIENT_RETRY_DELAY_MS = 100

/**
Retries after the first attempt, by default.
*/
const DEFAULT_RETRIES = 2

function retryDelay(attempt: number): number {
  return TRANSIENT_RETRY_DELAY_MS * attempt * (1 + Math.random() * 0.5)
}

/**
Run an ambient transaction unit: open a transaction, bind it as the
ambient scope for the work, commit on success / roll back on failure
(NTS-561 close semantics), and retry the whole unit in a fresh
transaction when the failure classifies as transient. Events and after*
observers queued by the work run only after a successful commit.
*/
export async function runAmbientTransaction<T>(
  begin: () => Promise<TransactionHandle>,
  eventEmitter: EventEmitter,
  work: (tx: TransactionalService) => Promise<T>,
  options: TransactionOptions = {},
  observers?: ObserverRegistry,
): Promise<T> {
  const retries = Math.max(0, options.retries ?? DEFAULT_RETRIES)
  const maxAttempts = 1 + retries

  for (let attempt = 1; ; attempt++) {
    // Begin failures are not retried: session acquisition is local — the
    // real transient windows (statement execution, commit) are below
    const handle = await begin()

    const scope = new AmbientTransactionScope(handle, {
      routing: options.routing ?? 'WRITE',
      database: options.database,
      retries,
      retryCommit: options.retryCommit ?? false,
    })

    const tx = new TransactionalService(handle, eventEmitter, scope.effects, false, observers)

    let result: T

    try {
      result = await runWithAmbientTransaction(scope, async () => work(tx))
    } catch (error) {
      scope.closed = true

      // The work closed the transaction explicitly and threw afterwards —
      // the terminal operation stands, rethrow untouched (NTS-561). A
      // commit that stood releases its queued events.
      if (tx.isSettled()) {
        if (tx.isCommitted()) {
          await scope.effects.flush()
        } else {
          scope.effects.discard()
        }

        throw error
      }

      scope.effects.discard()

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

      if (isRetryableError(classified) && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)))

        continue
      }

      throw classified
    }

    scope.closed = true

    if (!tx.isSettled()) {
      // The work resolved, but a joined call failed (or rolled back) and
      // its error was handled inside the callback — the transaction must
      // not commit
      if (scope.rollbackOnly) {
        scope.effects.discard()

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
        scope.effects.discard()

        // A failure while committing is ambiguous — the server may have
        // committed before the connection dropped, and re-running would
        // apply non-idempotent work twice. Only retried on explicit opt-in
        const classified = classifyError(error)

        if (options.retryCommit === true && isRetryableError(classified) && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)))

          continue
        }

        throw classified
      }
    }

    // Committed (by us or explicitly by the work): release the queued
    // events and after* observers. A rolled-back unit drops them.
    if (tx.isCommitted()) {
      await scope.effects.flush()
    } else {
      scope.effects.discard()
    }

    return result
  }
}
