import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import type {
  ConnectionProvider,
  QueryOutput,
  QueryParams as QueryParameters,
  QueryRecord,
  TransactionHandle,
} from './types.js'
import { isRecord } from '../services/type-guards.js'

/**
Client shapes from the embedded Relate engine (@relate/relate).
Kept as structural types so the client stays a soft dependency.
*/
type RelateResultRow = Record<string, unknown>

interface RelateResult {
  columns: string[]
  rows: RelateResultRow[]
  stats: Record<string, number>
}

interface RelateConnection {
  queryAsync(cypher: string, parameters?: Record<string, unknown>): Promise<RelateResult>
  query(cypher: string, parameters?: Record<string, unknown>): RelateResult
  begin(): void
  commit(): string | null
  rollback(): void
}

interface RelateDatabase {
  connect(namespace?: string): RelateConnection
  checkpoint(): void
}

interface RelateNodeValue {
  kind: 'node'
  elementId: string
  id: bigint | number
  labels: string[]
  properties: Record<string, unknown>
  [key: string]: unknown
}

interface RelateRelationshipValue {
  kind: 'relationship'
  elementId: string
  type: string
  startElementId: string
  endElementId: string
  properties: Record<string, unknown>
  [key: string]: unknown
}

/**
The embedded engine runs synchronously — commit/rollback/edition have
nothing to await, but keep the async TransactionHandle interface.
*/
const noop = (): void => undefined

/**
True when the loaded module exposes the Relate client surface used here.
*/
function isRelateClientModule(value: unknown): value is RelateClientModule {
  if (!isRecord(value)) {
    return false
  }

  // The client exports Database as a class with a static open(), which is
  // not a plain record
  const database: unknown = value['Database']
  const open: unknown =
    typeof database === 'function' || isRecord(database) ? Reflect.get(database, 'open') : undefined

  return typeof open === 'function'
}

/**
True for a Relate node value: a plain object with a `kind` discriminator.
*/
function isRelateNodeValue(value: Record<string, unknown>): value is RelateNodeValue {
  return (
    typeof value['elementId'] === 'string' &&
    Array.isArray(value['labels']) &&
    isRecord(value['properties'])
  )
}

/**
True for a Relate relationship value: a plain object with a `kind` discriminator.
*/
function isRelateRelationshipValue(
  value: Record<string, unknown>,
): value is RelateRelationshipValue {
  return (
    typeof value['elementId'] === 'string' &&
    typeof value['type'] === 'string' &&
    typeof value['startElementId'] === 'string' &&
    typeof value['endElementId'] === 'string' &&
    isRecord(value['properties'])
  )
}

/**
Recursively normalize the entries of a property map.
*/
function normalizeProperties(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, item]) => [key, normalizeRelateValue(item)]),
  )
}

/**
Resolve the Relate client module and native library.

The client is not yet published to npm, so it is loaded from disk:
  1. `RELATE_CLIENT_PATH` env var, or
  2. the sibling `relate` repository checkout (`../relate/clients/javascript`)

The native library location is passed through via `RELATE_LIB`
(see the Relate client's loader) — detected automatically here when
a sibling repository checkout exists.
*/
export function requireRelateClient(): RelateClientModule {
  const relateLibrary = process.env['RELATE_LIB']

  if (relateLibrary === undefined || relateLibrary === '') {
    for (const profile of ['release', 'debug']) {
      const candidate = resolveSiblingRepositoryLibrary(profile)

      if (candidate !== null) {
        process.env['RELATE_LIB'] = candidate
        break
      }
    }
  }

  // createRequire keeps the client a soft dependency: it is resolved at call
  // time (not import time) from node_modules or a sibling checkout
  const nodeRequire = createRequire(import.meta.url)

  try {
    const client: unknown = nodeRequire('@relate/relate')

    if (isRelateClientModule(client)) {
      return client
    }
  } catch {
    const sibling = resolveSiblingRepositoryClient()

    if (sibling !== null) {
      const siblingClient: unknown = nodeRequire(sibling)

      if (isRelateClientModule(siblingClient)) {
        return siblingClient
      }
    }
  }

  throw new NeodeError(
    'The Relate client could not be loaded. Install it into ../relate ' +
      '(git clone https://github.com/relatedb/relate && cargo build -p relate-ffi --release), ' +
      'or point RELATE_CLIENT_PATH / RELATE_LIB at a working build.',
  )
}

interface RelateClientModule {
  Database: {
    open(uri: string, options?: { readOnly?: boolean }): RelateDatabase
  }
}

function moduleDirectory(): string {
  return path.dirname(fileURLToPath(import.meta.url))
}

function resolveSiblingRepositoryClient(): string | null {
  const candidates = [
    process.env['RELATE_CLIENT_PATH'],
    path.resolve(moduleDirectory(), '../../../relate/clients/javascript'),
    path.resolve(moduleDirectory(), '../../../../relate/clients/javascript'),
  ].filter((candidate): candidate is string => candidate !== undefined && candidate !== '')

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.js'))) {
      return candidate
    }
  }

  return null
}

function resolveSiblingRepositoryLibrary(profile: string): string | null {
  const candidates = [
    path.resolve(moduleDirectory(), '../../../relate'),
    path.resolve(moduleDirectory(), '../../../../relate'),
  ]

  for (const repository of candidates) {
    for (const extension of ['dylib', 'so']) {
      const candidate = path.join(repository, 'target', profile, `librelate_ffi.${extension}`)

      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
  }

  return null
}

class RelateQueryRecord implements QueryRecord {
  private readonly columns: string[]
  private readonly row: RelateResultRow

  constructor(columns: string[], row: RelateResultRow) {
    this.columns = columns
    this.row = row
  }

  get(key: string): unknown {
    return normalizeRelateValue(this.row[key])
  }

  has(key: string): boolean {
    return this.columns.includes(key)
  }

  get keys(): string[] {
    return this.columns
  }
}

/**
Convert Relate values into the normalized graph shapes. Nodes and
relationships arrive as plain objects with a `kind` discriminator.
*/
export function normalizeRelateValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (isRecord(value)) {
    if (value['kind'] === 'node' && isRelateNodeValue(value)) {
      return {
        elementId: value.elementId,
        labels: value.labels,
        properties: normalizeProperties(value.properties),
      }
    }

    if (value['kind'] === 'relationship' && isRelateRelationshipValue(value)) {
      return {
        elementId: value.elementId,
        type: value.type,
        startElementId: value.startElementId,
        endElementId: value.endElementId,
        properties: normalizeProperties(value.properties),
      }
    }

    return normalizeProperties(value)
  }

  return Array.isArray(value) ? value.map((item) => normalizeRelateValue(item)) : value
}

import { classifyError, NeodeError, withQueryContext } from '../errors/index.js'

/**
The Relate JS client rejects with RelateError carrying the Neo4j error
code — classify it into the taxonomy (NTS-129) so both backends surface
typed errors, and carry the failing statement + redacted params on
unclassified failures (NTS-446)
*/
async function classified<T>(
  promise: Promise<T>,
  statement?: string,
  parameters?: QueryParameters,
): Promise<T> {
  try {
    return await promise
  } catch (error) {
    throw statement === undefined
      ? classifyError(error)
      : withQueryContext(error, statement, parameters)
  }
}

class RelateTransactionHandle implements TransactionHandle {
  private open = true

  private readonly connection: RelateConnection
  private readonly release: () => void = noop

  constructor(connection: RelateConnection, release?: () => void) {
    this.connection = connection
    this.release = release ?? noop
  }

  async run(statement: string, parameters?: QueryParameters): Promise<QueryOutput> {
    if (!this.open) {
      throw new NeodeError(
        'Transaction has already been closed — begin a new one with beginTransaction()',
      )
    }

    const result = await classified(
      this.connection.queryAsync(statement, parameters),
      statement,
      parameters,
    )

    return {
      records: result.rows.map((row) => new RelateQueryRecord(result.columns, row)),
      summary: { counters: result.stats },
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- the embedded engine commits synchronously; nothing to await
  async commit(): Promise<void> {
    if (!this.open) {
      return
    }

    this.open = false

    try {
      this.connection.commit()
    } catch (error) {
      throw classifyError(error)
    }

    this.release()
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- the embedded engine rolls back synchronously; nothing to await
  async rollback(): Promise<void> {
    if (!this.open) {
      return
    }

    this.open = false

    try {
      this.connection.rollback()
    } catch (error) {
      throw classifyError(error)
    }

    this.release()
  }
}

/**
ConnectionProvider over the embedded Relate engine (@relate/relate) —
in-process, no Bolt server. The engine is a soft dependency, loaded at
construction time; the client shapes are structural so it stays that way.
*/
export class RelateConnectionProvider implements ConnectionProvider {
  private readonly connection: RelateConnection

  /**
  The embedded engine supports ONE transaction at a time per connection.
  Facade flows run concurrently (e.g. Promise.all of saves), so
  beginTransaction serialises: each transaction holds the slot from
  begin() until its commit/rollback.
  */
  private queue: Promise<void> = Promise.resolve()
  private txOpen = false

  constructor(database: RelateDatabase, namespace = 'neo4j') {
    requireRelateClient() // the native library is loaded at require-time

    this.connection = database.connect(namespace)
  }

  /**
  The embedded engine runs in a single namespace, fixed when the provider
  is constructed (`namespace`): the per-call `database` override and the
  access mode are accepted for port parity on the ConnectionProvider
  interface and ignored here.
  */
  async run(statement: string, parameters?: QueryParameters): Promise<QueryOutput> {
    if (this.txOpen) {
      throw new NeodeError(
        "A transaction is open on this connection: use the transaction's own " +
          'methods for statements that belong to it, or commit/rollback first',
      )
    }

    const result = await classified(
      this.connection.queryAsync(statement, parameters),
      statement,
      parameters,
    )

    return {
      records: result.rows.map((row) => new RelateQueryRecord(result.columns, row)),
      summary: { counters: result.stats },
    }
  }

  async beginTransaction(): Promise<TransactionHandle> {
    const previous = this.queue

    let release!: () => void
    this.queue = new Promise<void>((resolve) => (release = resolve))

    await previous

    this.txOpen = true
    this.connection.begin()

    return new RelateTransactionHandle(this.connection, () => {
      this.txOpen = false
      release()
    })
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- the embedded engine has no editions and no async call behind this
  async edition(): Promise<'enterprise' | 'community' | 'unknown'> {
    // The embedded engine has no editions
    return 'community'
  }

  async close(): Promise<void> {
    // The connection is owned by the database instance
  }
}
