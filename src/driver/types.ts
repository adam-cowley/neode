/**
Database-agnostic interfaces — the port between the OGM and any
Cypher-compatible database client.

Two implementations ship:
 - `Neo4jConnectionProvider` — neo4j-driver over Bolt
   (Neo4j Community/Enterprise, Memgraph, Aura, `relate serve`)
 - `RelateConnectionProvider` — the embedded Relate engine, in-process
*/
import type { Newable } from '../meta/newable.js'

/**
A node value in a normalized shape, as returned in result records.
*/
export interface GraphNode {
  elementId: string
  labels: string[]
  properties: Record<string, unknown>
}

/**
A relationship value in a normalized shape, as returned in result records.
*/
export interface GraphRelationship {
  elementId: string
  type: string
  startElementId: string
  endElementId: string
  properties: Record<string, unknown>
}

/**
One row of a query result.
*/
export interface QueryRecord {
  get(key: string): unknown
  has(key: string): boolean
  readonly keys: string[]
}

/**
A query result, independent of the underlying client.
*/
export interface QueryOutput {
  records: QueryRecord[]
  summary?: QuerySummary | undefined
}

/**
Metadata for one executed statement: write counters and (when the
statement is prefixed with EXPLAIN / PROFILE) the server's plan.
*/
export interface QuerySummary {
  counters?: Record<string, number>
  /**
  The server's execution plan, as returned for EXPLAIN statements
  (the driver's plan tree; backends that produce no plans leave it unset)
  */
  plan?: unknown
  /**
  The profiled execution plan, as returned for PROFILE statements
  */
  profile?: unknown
}

/**
A map of Cypher parameter names to values, bound into the statement —
values never render into the query text itself.
*/
// eslint-disable-next-line unicorn/name-replacements -- `QueryParams` is the documented public API name and imported by name in the test suites; renaming is a breaking change
export type QueryParams = Record<string, unknown>

/**
Anything able to run statements in its scope (autocommit or transaction).
*/
export interface Runner {
  run(
    statement: string,
    parameters?: QueryParams,
    /**
    Routing hint — bare runners ignore it (ConnectionProvider routes by it)
    */
    mode?: AccessMode,
  ): Promise<QueryOutput>
}

/**
An explicit transaction: statements run in scope until commit/rollback.
*/
export interface TransactionHandle extends Runner {
  commit(): Promise<void>
  rollback(): Promise<void>
}

/**
Session routing for a statement: 'READ' (replica-capable) or 'WRITE'
(primaries). Where a query path leaves routing open, the facade's
defaultRouting (itself defaulting to 'READ') decides;
ConnectionProvider#run defaults to 'WRITE'.
*/
export type AccessMode = 'READ' | 'WRITE'

/**
Options a Neode instance accepts alongside its ConnectionProvider.
*/
export interface ConnectionOptions {
  /**
  Routing used when a query path leaves it open — `Neode#cypher` without
  a per-call `routing` (defaultRouting itself defaults to 'READ')
  */
  defaultRouting?: AccessMode

  /**
  Milliseconds a statement / transaction waits for the embedded Relate
  engine's single transaction slot before failing — forwarded to
  `RelateConnectionProvider` by `forRelate` (default 30000; `0` or
  `Infinity` waits forever). Ignored by the other providers.
  */
  queueTimeoutMs?: number
}

/**
Options for the unified raw query entry, `Neode#cypher`.
*/
export interface CypherOptions {
  /**
  'READ' (default) or 'WRITE' — wins over the connection's defaultRouting
  */
  routing?: AccessMode
  /**
  Per-call database override
  */
  database?: string
  /**
  Hydrate each row into a registered entity of this class
  */
  hydrate?: Newable
  /**
  Column that holds the node to hydrate (default 'this')
  */
  alias?: string
  /**
  Map each record before it reaches the caller: the returned value
  replaces the record in the result's `records` array. The transformer
  sees the row JSON-safe (the pass every `cypher()` row already goes
  through). Ignored when `hydrate` is set — hydration owns the rows
  then. Shape the rows into plain objects to skip the `.get()` plumbing:
  `recordTransformer: (row) => ({ id: row.get('id') })`
  */
  recordTransformer?: (record: QueryRecord) => unknown
}

/**
A query result whose rows were mapped by a `recordTransformer` — the row
shape is the transformer's return type, known only at the call site.
*/
export interface TransformedQueryOutput<Row = unknown> {
  records: Row[]
  summary?: QuerySummary | undefined
}

/**
Options for the hydrate overloads of the build-and-run sugar,
`Neode#read` / `Neode#write` (NTS-559): with a `hydrate` class the rows
are hydrated into entities of that class instead of returned raw.
*/
export interface HydrateQueryOptions {
  /**
  Column that holds the node to hydrate (default 'this')
  */
  alias?: string
  /**
  Per-call database override
  */
  database?: string
  /**
  Map each raw row before it reaches the caller — the
  CypherOptions.recordTransformer option, on the `Neode#read` /
  `Neode#write` sugar (pass the options object as the third argument).
  The transformer sees the row JSON-safe. Ignored when `hydrate` is set.
  */
  recordTransformer?: (record: QueryRecord) => unknown
}

/**
The connection port implemented by every backend.
*/
export interface ConnectionProvider {
  /**
  Run a single statement in an implicit transaction.
  */
  run(
    statement: string,
    parameters?: QueryParams,
    mode?: AccessMode,
    /**
    Per-call database override — backends with a single namespace ignore it
    */
    database?: string,
  ): Promise<QueryOutput>

  /**
  Open an explicit transaction. Remember to commit or rollback.
  */
  beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle>

  /**
  Server edition, if reported: 'enterprise' | 'community' | 'unknown'
  */
  edition(): Promise<'enterprise' | 'community' | 'unknown'>

  close(): Promise<void>
}
