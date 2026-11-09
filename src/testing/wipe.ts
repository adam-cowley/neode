import type { Runner } from '../driver/types.js'
import { NeodeError } from '../errors/neode-error.js'

/** A Runner, or any facade exposing one (e.g. Neode — matched structurally
to avoid importing the service here). */
export type WipeTarget = Runner | { getRunner(): Runner }

/**
Guard options for wipe() (NTS-578). wipe() is destructive on whatever
database the runner points at, so it refuses to run without an explicit
opt-in.
*/
export interface WipeOptions {
  /**
  Explicit opt-in: `true` acknowledges that every node, constraint, index
  and the graph type of the connected database will be destroyed. The
  `NEODE_ALLOW_WIPE=true` environment variable is the suite-wide
  equivalent (set it once in a test setup file).
  */
  confirm?: boolean
  /**
  The name of the database you intend to wipe: checked against the
  database the runner is actually connected to (`CALL db.info()`), and the
  wipe is refused on a mismatch or when the name cannot be verified.
  */
  database?: string
  /**
  The connection URI being wiped (defaults to `NEO4J_URI` when set). A
  runner does not expose its URI, so the remote-host guard can only check
  what it is told: a non-local host is refused unless `allowRemote` is set.
  */
  uri?: string
  /**
  Allow wiping a database on a non-local host (default: refused)
  */
  allowRemote?: boolean
  /**
  Nodes deleted per transaction (default 10 000)
  */
  batchSize?: number
}

/**
One schema object wipe() tried to drop and could not
*/
export interface WipeFailure {
  kind: 'constraint' | 'index'
  name: string
  error: string
}

/**
What wipe() did. Returned instead of `void` (NTS-578): awaiting wipe() and
ignoring the result keeps working.
*/
export interface WipeReport {
  /**
  Nodes that existed (and were detach-deleted) before the wipe
  */
  nodesDeleted: number
  /**
  How the nodes were deleted: batched `CALL { } IN TRANSACTIONS`, or
  repeated `LIMIT`ed deletes where that syntax is unavailable
  (explicit transactions, embedded engines)
  */
  deleteStrategy: 'in-transactions' | 'limit-loop'
  /**
  Whether `ALTER CURRENT GRAPH TYPE SET { }` ran (false: unsupported here)
  */
  wasGraphTypeReset: boolean
  constraintsDropped: string[]
  indexesDropped: string[]
  /**
  Drops that failed for a reason other than "does not exist" — the schema
  those objects belong to still exists
  */
  failed: WipeFailure[]
}

const DEFAULT_BATCH_SIZE = 10_000
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
Errors that only mean "this server does not know that syntax / feature" —
the only ones wipe() tolerates. Anything else (authentication, permissions,
connectivity) is surfaced.
*/
const isUnsupported = (error: unknown): boolean =>
  /syntax|invalid input|unsupported|not supported|not (?:been )?implemented|unknown (?:command|procedure)|implicit transaction|graph type|unrecognized|unexpected/i.test(
    message(error),
  )

const hostOf = (uri: string): string | undefined => {
  const match = /^[a-z][\d+.a-z-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^/:?]+)/i.exec(uri)

  return match?.[1]?.toLowerCase()
}

const isLocalHost = (host: string): boolean =>
  LOCAL_HOSTS.has(host) || host.endsWith('.localhost') || host.startsWith('127.')

async function assertGuards(runner: Runner, options: WipeOptions): Promise<void> {
  if (options.confirm !== true && process.env['NEODE_ALLOW_WIPE'] !== 'true') {
    throw new NeodeError(
      'wipe() refused in the connected database — it deletes every node and drops every ' +
        'constraint, index and the graph type, and no explicit opt-in was given. ' +
        'Pass `wipe(target, { confirm: true })` (optionally with `database: "<name>"` to ' +
        'pin the target), or set NEODE_ALLOW_WIPE=true in your test setup.',
    )
  }

  const uri = options.uri ?? process.env['NEO4J_URI']

  if (uri !== undefined && options.allowRemote !== true) {
    const host = hostOf(uri)

    if (host !== undefined && !isLocalHost(host)) {
      throw new NeodeError(
        `wipe() refused for "${uri}" — host "${host}" is not local, so this is probably not a ` +
          'throwaway test database. Point the test run at a local database, or pass ' +
          '`{ confirm: true, allowRemote: true }` if wiping this remote database is intended.',
      )
    }
  }

  await assertDatabase(runner, options.database)
}

async function assertDatabase(runner: Runner, expected: string | undefined): Promise<void> {
  if (expected === undefined) {
    return
  }

  let connected: unknown

  try {
    const output = await runner.run('CALL db.info() YIELD name RETURN name', {}, 'READ')

    connected = output.records[0]?.get('name')
  } catch (error) {
    if (!isUnsupported(error)) {
      throw error
    }
  }

  if (connected !== expected) {
    throw new NeodeError(
      `wipe() refused — expected database "${expected}" but the runner is connected ` +
        `to ${typeof connected === 'string' ? `"${connected}"` : 'a database whose name could not be verified'}. ` +
        'Connect to the intended database (or fix the `database` option), or drop the ' +
        '`database` option if you do not want the name pinned.',
    )
  }
}

async function deleteNodes(
  runner: Runner,
  batchSize: number,
): Promise<Pick<WipeReport, 'nodesDeleted' | 'deleteStrategy'>> {
  const counted = await runner.run('MATCH (n) RETURN count(n) AS count', {}, 'READ')
  const raw = counted.records[0]?.get('count')
  const nodesDeleted = Number(String(raw))

  if (nodesDeleted === 0) {
    return { nodesDeleted: 0, deleteStrategy: 'in-transactions' }
  }

  const batch = Math.max(1, Math.trunc(batchSize))

  try {
    // Batched, constant-memory delete — implicit transactions only. The batch
    // size is an integer literal: JS numbers travel as FLOAT parameters over
    // Bolt, which the clause rejects
    await runner.run(
      `MATCH (n) CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF ${String(batch)} ROWS`,
    )

    return { nodesDeleted, deleteStrategy: 'in-transactions' }
  } catch (error) {
    if (!isUnsupported(error)) {
      throw error
    }
  }

  // Fallback: bounded deletes in a loop (works in explicit transactions and
  // on engines without CALL IN TRANSACTIONS)
  for (;;) {
    const output = await runner.run(
      `MATCH (n) WITH n LIMIT ${String(batch)} DETACH DELETE n RETURN count(*) AS deleted`,
    )
    const deleted = output.records[0]?.get('deleted')

    if (deleted === undefined || Number(deleted) === 0) {
      break
    }
  }

  return { nodesDeleted, deleteStrategy: 'limit-loop' }
}

/**
Wipe the database clean for a test run: DETACH DELETE every node (batched,
`CALL { } IN TRANSACTIONS` where supported), reset the graph type to empty
(NTS-550 — graph-type-derived constraints only go with the type; Enterprise
servers only), then drop every constraint and index the database currently
has.

DESTRUCTIVE (NTS-578): this destroys whatever database the runner points
at, so it refuses to run without `{ confirm: true }` (or
`NEODE_ALLOW_WIPE=true`), refuses a non-local `uri` (or `NEO4J_URI`) unless
`allowRemote: true`, and verifies the connected database name when
`database` is given. Never point it at a shared database.

Standalone on purpose — SchemaService derives DROP statements from the
registered models, while wipe() discovers them from the database itself
(small duplication of its statement shapes, accepted).

Only "unsupported syntax" errors are tolerated (graph types on Community /
pre-2026.02 servers); everything else — authentication, permissions,
connectivity — is thrown. Constraint and index drops that fail are listed
in the returned report's `failed` instead of being swallowed; built-in
lookup indexes are skipped.
*/
export async function wipe(target: WipeTarget, options: WipeOptions = {}): Promise<WipeReport> {
  const runner = resolveRunner(target)

  await assertGuards(runner, options)

  const deleted = await deleteNodes(runner, options.batchSize ?? DEFAULT_BATCH_SIZE)

  let wasGraphTypeReset = false

  try {
    // `ALTER CURRENT GRAPH TYPE SET { }` is the documented full reset —
    // it drops the graph type and every constraint it enforced
    await runner.run('ALTER CURRENT GRAPH TYPE SET { }')

    wasGraphTypeReset = true
  } catch (error) {
    if (!isUnsupported(error)) {
      throw error
    }
    // Community / pre-2026.02 servers have no graph types
  }

  const report: WipeReport = {
    ...deleted,
    wasGraphTypeReset,
    constraintsDropped: [],
    indexesDropped: [],
    failed: [],
  }

  const constraints = await runner.run('SHOW CONSTRAINTS')

  for (const record of constraints.records) {
    const name = String(record.get('name'))

    try {
      await runner.run(`DROP CONSTRAINT \`${name}\` IF EXISTS`)

      report.constraintsDropped.push(name)
    } catch (error) {
      // Graph-type-owned constraints may refuse a standalone drop
      report.failed.push({ kind: 'constraint', name, error: message(error) })
    }
  }

  const indexes = await runner.run('SHOW INDEXES')

  for (const record of indexes.records) {
    const name = String(record.get('name'))

    // Built-in token lookup indexes cannot be dropped
    if (record.has('type') && String(record.get('type')) === 'LOOKUP') {
      continue
    }

    try {
      await runner.run(`DROP INDEX \`${name}\` IF EXISTS`)

      report.indexesDropped.push(name)
    } catch (error) {
      report.failed.push({ kind: 'index', name, error: message(error) })
    }
  }

  return report
}

function resolveRunner(target: WipeTarget): Runner {
  return 'getRunner' in target ? target.getRunner() : target
}
