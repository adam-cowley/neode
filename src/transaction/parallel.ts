/**
parallel() — fan operations out across CONCURRENT sessions (NTS-631).

One transaction serialises its statements on one connection, so true
concurrency means multiple sessions — one per operation. Three modes:

- 'read' (default) — every operation runs on its own READ-routed
  autocommit session: N independent reads resolve in one wall-clock
  batch instead of N sequential round trips (the dashboard case; the
  `readMany({ tiles, throughput })` sugar a consumer writes falls out
  of this).
- 'write' — every operation runs on its own WRITE-routed autocommit
  session. NO cross-operation atomicity: a failure halfway through
  leaves the earlier writes committed. Every operation still runs, and
  the failures surface in one ParallelError aligned with the input.
- 'atomic' — all-or-nothing across sessions: one WRITE transaction per
  operation is opened, every body runs in parallel against its own
  transaction, and the transactions are committed sequentially ONLY if
  every body succeeded — any body failure rolls back every open
  transaction. All-or-nothing without a distributed-commit protocol: a
  COMMIT-phase failure remains the documented residual risk (the bodies
  ran on independent transactions, so the failed commit's work cannot
  be rolled back by this helper) and surfaces as a 'commit'-phase
  ParallelError, per handle.

Contention caveat: parallel writes touching the same nodes serialize on
the database's locks — keep the operation set NODE-DISJOINT. Writes that
must touch the same nodes stay sequential in ONE transaction
(`inWriteTransaction()` / `transaction()`), which pipelines them on one
connection.

Backend caveat: atomic mode holds every transaction open until ALL
bodies settle, so it needs a backend with CONCURRENT sessions
(neo4j-driver over Bolt). The embedded Relate engine runs ONE
transaction per connection — its begin queue releases the slot only on
commit/rollback (NTS-545) — so atomic mode with more than one operation
deadlocks there; on Relate use the autocommit modes (statements queue
safely, correct but with no wall-clock gain) or keep the writes in one
sequential transaction (batch() / transaction()).
*/
import type {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  // eslint-disable-next-line unicorn/name-replacements -- `QueryParams` is the documented public API name (driver/types.ts), imported by name in the test suites
  QueryParams,
  Runner,
  TransactionHandle,
} from '../driver/types.js'
import { NeodeError } from '../errors/index.js'
import type { Builder } from '../query/index.js'

/**
One failed operation of a parallel() fan-out.
*/
export interface ParallelOperationError {
  /**
  The operation's key in the input map, or its zero-based position as a
  string in the input array
  */
  key: string

  /**
  The operation's own error
  */
  error: unknown
}

/**
Atomic-mode rollback report: what the rollback of the opened
transactions did after a body failed.
*/
export interface ParallelRollbackReport {
  /**
  Keys whose transactions were rolled back, in input order
  */
  rolledBack: string[]

  /**
  Keys whose rollback itself failed — the transaction may stay open
  server-side until the server's transaction timeout (the same residual
  risk any failed rollback carries). Terminate leaked transactions
  (SHOW TRANSACTIONS, then TERMINATE).
  */
  failures: ParallelOperationError[]
}

/**
Thrown by parallel() when an operation fails (NTS-631):

- autocommit modes ('read' / 'write') — `phase` is 'body' and `errors`
  carries every failed operation in input order. Nothing is rolled back
  (autocommit has nothing to roll back) and `rollback` is undefined.
- atomic mode — `phase` is 'body' when an operation body failed (every
  open transaction was rolled back first; `rollback` reports how that
  went), or 'commit' when every body succeeded but a commit failed (the
  documented residual risk, surfaced per handle).

The first failure is also set as the error's `cause`.
*/
export class ParallelError extends NeodeError {
  /**
  The failed operations, in input order
  */
  readonly errors: ParallelOperationError[]

  /**
  Which phase failed: 'body' — an operation body threw; 'commit' — every
  body succeeded but a commit failed (atomic mode only)
  */
  readonly phase: 'body' | 'commit'

  /**
  Atomic mode only: what the rollback of the opened transactions did.
  Undefined in the autocommit modes and in commit-phase failures.
  */
  readonly rollback: ParallelRollbackReport | undefined

  constructor(
    phase: 'body' | 'commit',
    errors: ParallelOperationError[],
    rollback?: ParallelRollbackReport,
  ) {
    super(
      `parallel() ${phase} failure in operation(s) ${errors.map((failure) => failure.key).join(', ')}` +
        ' — see the `errors` property for the per-operation failures',
      { cause: errors[0]?.error },
    )

    this.name = 'ParallelError'

    this.errors = errors
    this.phase = phase
    this.rollback = rollback
  }
}

/**
What parallel() fans out as:

- 'read' (default) — concurrent READ autocommit sessions
- 'write' — concurrent WRITE autocommit sessions, no cross-operation atomicity
- 'atomic' — one WRITE transaction per operation, all-or-nothing commit
*/
export type ParallelMode = 'read' | 'write' | 'atomic'

/**
Options for parallel().
*/
export interface ParallelOptions {
  /**
  The fan-out mode — see the parallel() docs. Default 'read'.
  */
  mode?: ParallelMode

  /**
  Database the sessions open against (multi-database backends). In
  atomic mode this is the database every transaction opens on.
  */
  database?: string
}

/**
One parallel() operation: receives the operation's own scope and
resolves when its work is done. A callback, not a promise — a
transaction cannot open before the body runs.
*/
export type ParallelBody<T> = (scope: ParallelScope) => Promise<T>

/**
The scope one parallel() operation runs on: a Runner bound to the
operation's own session (autocommit modes) or transaction (atomic
mode), plus the facade's build-and-run sugar — pass a Builder or a raw
string. Routing is fixed per scope (the mode option decides it once); a
transaction's routing was fixed when it opened.
*/
export interface ParallelScope extends Runner {
  /**
  Build-and-run a Builder (or run a raw string) as a READ statement on
  this operation's own session/transaction
  */
  read(query: Builder | string, parameters?: QueryParams): Promise<QueryOutput>

  /**
  WRITE counterpart of read()
  */
  write(query: Builder | string, parameters?: QueryParams): Promise<QueryOutput>
}

/**
One settled fan-out operation: 'ok' with its result or 'failed' with
its error — keyed like the input either way.
*/
type ParallelOutcome<T> =
  | { key: string; state: 'ok'; result: T }
  | { key: string; state: 'failed'; error: unknown }

/**
Run one operation to a settled keyed outcome instead of rejecting — the
aggregate error stays aligned with the input rather than short-cutting
on the first failure.
*/
async function settle<T>(key: string, attempt: Promise<T>): Promise<ParallelOutcome<T>> {
  try {
    return { key, state: 'ok', result: await attempt }
  } catch (error) {
    return { key, state: 'failed', error }
  }
}

/**
The facade's build-and-run sugar over one run function.
*/
function buildRunner(
  run: (statement: string, parameters: QueryParams) => Promise<QueryOutput>,
): (query: Builder | string, parameters?: QueryParams) => Promise<QueryOutput> {
  return async (query, parameters = {}) => {
    if (typeof query === 'string') {
      return run(query, parameters)
    }

    const built = query.build()

    return run(built.query, { ...built.params, ...parameters })
  }
}

/**
The autocommit scope: every statement is its own implicit session on
the connection, routed by the fixed mode. It bypasses ambient
transactions by construction — parallel() fans out fresh sessions even
when called inside `transaction()`.
*/
function autocommitScope(
  connection: ConnectionProvider,
  defaultMode: AccessMode,
  database: string | undefined,
): ParallelScope {
  return {
    run: async (statement, parameters = {}, mode) =>
      connection.run(statement, parameters, mode ?? defaultMode, database),
    read: buildRunner(async (statement, parameters) =>
      connection.run(statement, parameters, 'READ', database),
    ),
    write: buildRunner(async (statement, parameters) =>
      connection.run(statement, parameters, 'WRITE', database),
    ),
  }
}

/**
The atomic scope: every statement runs on the operation's own open
transaction (the transaction's routing was fixed at open time, so
read() and write() both delegate to the handle). The scope exposes no
commit/rollback — parallel() owns the transaction's lifecycle.
*/
function transactionScope(handle: TransactionHandle): ParallelScope {
  return {
    run: async (statement, parameters = {}) => handle.run(statement, parameters),
    read: buildRunner(async (statement, parameters) => handle.run(statement, parameters)),
    write: buildRunner(async (statement, parameters) => handle.run(statement, parameters)),
  }
}

type ParallelEntry<T> = [key: string, body: ParallelBody<T>]

/**
The 'read' / 'write' fan-out: one autocommit session flow per
operation, every failure collected into one ParallelError.
*/
async function runParallelAutocommit<T>(
  connection: ConnectionProvider,
  entries: ParallelEntry<T>[],
  options: ParallelOptions,
): Promise<[string, T][]> {
  const mode: AccessMode = options.mode === 'write' ? 'WRITE' : 'READ'
  const scope = autocommitScope(connection, mode, options.database)

  // Every operation is attempted, so the error report covers the set
  const outcomes = await Promise.all(entries.map(async ([key, body]) => settle(key, body(scope))))

  return collectOutcomes(outcomes)
}

function collectOutcomes<T>(outcomes: ParallelOutcome<T>[]): [string, T][] {
  const results: [string, T][] = []
  const failures: ParallelOperationError[] = []

  for (const outcome of outcomes) {
    if (outcome.state === 'failed') {
      failures.push({ key: outcome.key, error: outcome.error })
    } else {
      results.push([outcome.key, outcome.result])
    }
  }

  if (failures.length > 0) {
    throw new ParallelError('body', failures)
  }

  return results
}

/**
One atomic-mode operation: open the operation's own WRITE transaction,
record the handle for the close phase, then run the body on it.
*/
async function atomicBody<T>(
  connection: ConnectionProvider,
  options: ParallelOptions,
  opened: { key: string; handle: TransactionHandle }[],
  key: string,
  body: ParallelBody<T>,
): Promise<T> {
  const handle = await connection.beginTransaction('WRITE', options.database)

  opened.push({ key, handle })

  return body(transactionScope(handle))
}

/**
The 'atomic' fan-out: one WRITE transaction per operation, bodies in
parallel, then commit-all or rollback-all (NTS-631).
*/
async function runParallelAtomic<T>(
  connection: ConnectionProvider,
  entries: ParallelEntry<T>[],
  options: ParallelOptions,
): Promise<[string, T][]> {
  // Handles are recorded the moment they open, so a failure anywhere
  // still leaves every open transaction reachable for the close phase
  const opened: { key: string; handle: TransactionHandle }[] = []

  // Each operation opens its transaction, then runs its body on it: no
  // operation waits for another operation's transaction to CLOSE before
  // its own begins (on the embedded Relate engine the begins queue
  // instead of deadlocking)
  const outcomes = await Promise.all(
    entries.map(async ([key, body]) =>
      settle(key, atomicBody(connection, options, opened, key, body)),
    ),
  )

  const { results, failures } = splitOutcomes(outcomes)

  if (failures.length > 0) {
    // Any body failure: roll back EVERY open transaction, then report
    // the failures with the rollback report (the first failure is the
    // ParallelError's cause)
    return await rollbackAll(opened, failures)
  }

  await commitAll(opened)

  return results
}

function splitOutcomes<T>(outcomes: ParallelOutcome<T>[]): {
  results: [string, T][]
  failures: ParallelOperationError[]
} {
  const results: [string, T][] = []
  const failures: ParallelOperationError[] = []

  for (const outcome of outcomes) {
    if (outcome.state === 'failed') {
      failures.push({ key: outcome.key, error: outcome.error })
    } else {
      results.push([outcome.key, outcome.result])
    }
  }

  return { results, failures }
}

/**
Roll back every open transaction, in input order, then throw the
aggregate body failure with the rollback report. A rollback that itself
fails never masks the body failure — it is reported instead.
*/
async function rollbackAll(
  opened: { key: string; handle: TransactionHandle }[],
  failures: ParallelOperationError[],
): Promise<never> {
  const rolledBack: string[] = []
  const rollbackFailures: ParallelOperationError[] = []

  for (const { key, handle } of opened) {
    try {
      await handle.rollback()

      rolledBack.push(key)
    } catch (error) {
      rollbackFailures.push({ key, error })
    }
  }

  throw new ParallelError('body', failures, { rolledBack, failures: rollbackFailures })
}

/**
Commit every transaction sequentially, in input order. A failed commit
does not stop the rest (the failed transaction's work is already decided
server-side; committing the others stays correct) — the failures throw
as a 'commit'-phase ParallelError, per handle.
*/
async function commitAll(opened: { key: string; handle: TransactionHandle }[]): Promise<void> {
  const commitFailures: ParallelOperationError[] = []

  for (const { key, handle } of opened) {
    try {
      await handle.commit()
    } catch (error) {
      commitFailures.push({ key, error })
    }
  }

  if (commitFailures.length > 0) {
    throw new ParallelError('commit', commitFailures)
  }
}

/**
Fan operations out across concurrent sessions (NTS-631) — the engine
behind `Neode#parallel` and `TransactionalService#parallel`. Accepts a
named map (results keyed by name) or an array (results in input order).
*/
export async function runParallel<T>(
  connection: ConnectionProvider,
  operations: Record<string, ParallelBody<T>> | ParallelBody<T>[],
  options: ParallelOptions = {},
): Promise<Record<string, T> | T[]> {
  const entries: ParallelEntry<T>[] = Array.isArray(operations)
    ? operations.map((body, index): ParallelEntry<T> => [String(index), body])
    : Object.entries(operations)

  const results =
    options.mode === 'atomic'
      ? await runParallelAtomic(connection, entries, options)
      : await runParallelAutocommit(connection, entries, options)

  return Array.isArray(operations) ? results.map((entry) => entry[1]) : Object.fromEntries(results)
}
