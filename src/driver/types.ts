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
