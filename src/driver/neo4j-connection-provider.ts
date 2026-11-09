/* eslint-disable unicorn/name-replacements -- "Neo4j" is the product name (the rule's `j` -> `index` replacement misfires on it), and these are the documented public class names */ import {
  type Driver,
  type Node as DriverNode,
  type Record as DriverRecord,
  type Relationship as DriverRelationship,
  type Session as DriverSession,
  session as DriverSessionMode,
  type QueryResult,
  type Transaction as DriverTransaction,
  Integer as DriverInteger,
  isDate,
  isDateTime,
  isDuration,
  isLocalDateTime,
  isLocalTime,
  isPoint,
  isTime,
} from 'neo4j-driver'

import type {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams as QueryParameters,
  QueryRecord,
  TransactionHandle,
} from './types.js'
import { classifyError, NeodeError, withQueryContext } from '../errors/index.js'
import { isRecord } from '../services/type-guards.js'

/**
Recursively normalize the entries of a property map.
*/
function normalizeProperties(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, item]) => [key, normalizeDriverValue(item)]),
  )
}

/**
Integer to number, refusing a silent precision loss (NTS-582): a value
outside the safe-integer range throws instead of rounding.
*/
function safeToNumber(value: DriverInteger): number {
  if (!DriverInteger.inSafeRange(value)) {
    throw new NeodeError(
      `The integer ${value.toString()} is outside JavaScript's safe integer range and cannot be represented as a number without losing precision. Return it as a string in the query (toString(n)) or split it, instead of reading it as a number.`,
    )
  }

  return value.toNumber()
}

/**
Shallow clone of a driver temporal/point instance with every Integer field
converted to a plain number (same prototype, so instanceof and the
duck-typed guards still recognise it). The original is returned untouched
when it has no Integer fields — with driver 6's native-number temporals
that is the common case, and identity survives.
*/
function normalizeInternalIntegers(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }

  const clone: Record<string, unknown> = { ...value }

  // Keep the driver prototype — the __is*__ duck-typed markers the driver's
  // own guards (and ours) check live there, not on the instance
  Object.setPrototypeOf(clone, Reflect.getPrototypeOf(value))

  let hasIntegerFields = false

  for (const [key, item] of Object.entries(value)) {
    if (!DriverInteger.isInteger(item)) {
      continue
    }

    clone[key] = safeToNumber(item)
    hasIntegerFields = true
  }

  return hasIntegerFields ? clone : value
}

/**
Walk a driver result value and normalize driver-specific types
(Node, Relationship, Integer, temporal, point) into plain JS shapes.
*/
export function normalizeDriverValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  // Integers are natively represented in driver 5+, but the type can still
  // appear when lossless integers are enabled — convert defensively.
  if (DriverInteger.isInteger(value)) {
    return safeToNumber(value)
  }

  if (isDriverNode(value)) {
    return {
      elementId: value.elementId,
      labels: value.labels,
      properties: normalizeProperties(value.properties),
    }
  }

  if (isDriverRelationship(value)) {
    return {
      elementId: value.elementId,
      type: value.type,
      startElementId: value.startNodeElementId,
      endElementId: value.endNodeElementId,
      properties: normalizeProperties(value.properties),
    }
  }

  // Temporal / spatial types pass through — but their internal Integer
  // fields (Point.srid, Date.year, Time.nanosecond, …) are normalized to
  // plain numbers, matching how property integers are treated above. The
  // clone keeps the driver prototype, so instanceof and the driver's
  // duck-typed guards (including a second copy of neo4j-driver in
  // pnpm/link setups) still recognise it.
  if (
    isDateTime(value) ||
    isDate(value) ||
    isTime(value) ||
    isLocalTime(value) ||
    isLocalDateTime(value) ||
    isDuration(value) ||
    isPoint(value)
  ) {
    return normalizeInternalIntegers(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeDriverValue(item))
  }

  if (isRecord(value)) {
    return normalizeProperties(value)
  }

  return value
}

function isDriverNode(value: unknown): value is DriverNode {
  return (
    isRecord(value) &&
    typeof value['elementId'] === 'string' &&
    Array.isArray(value['labels']) &&
    isRecord(value['properties'])
  )
}

function isDriverRelationship(value: unknown): value is DriverRelationship {
  return (
    isRecord(value) &&
    typeof value['elementId'] === 'string' &&
    typeof value['type'] === 'string' &&
    typeof value['startNodeElementId'] === 'string'
  )
}

class DriverQueryRecord implements QueryRecord {
  private readonly record: DriverRecord

  constructor(record: DriverRecord) {
    this.record = record
  }

  get(key: string): unknown {
    return normalizeDriverValue(this.record.get(key))
  }

  has(key: string): boolean {
    return this.record.has(key)
  }

  get keys(): string[] {
    // The driver types record keys as `Key` (string | number); field names are strings
    return this.record.keys.map(String)
  }
}

/**
Close a session without masking the caller's outcome (NTS-576): a failing
close never replaces a successful result or the original error — the
driver already releases the connection on its own failure paths.
*/
async function closeQuietly(session: DriverSession): Promise<void> {
  try {
    await session.close()
  } catch {
    // Intentionally swallowed — see above
  }
}

function summaryOf(result: QueryResult): NonNullable<QueryOutput['summary']> {
  return {
    counters: Object.fromEntries(
      Object.entries(result.summary.counters.updates()).filter(([, value]) => value > 0),
    ),
    // Populated by EXPLAIN / PROFILE statements (query options
    // are not used; the keywords prefix the statement itself)
    plan: result.summary.plan,
    profile: result.summary.profile,
  }
}

export class Neo4jTransactionHandle implements TransactionHandle {
  private readonly session: DriverSession
  private readonly tx: DriverTransaction

  constructor(session: DriverSession, tx: DriverTransaction) {
    this.session = session
    this.tx = tx
  }

  async run(statement: string, parameters?: QueryParameters): Promise<QueryOutput> {
    try {
      const result = await this.tx.run(statement, parameters)

      // The summary rides along so write counters (created vs matched) are
      // visible inside a transaction too — save()'s create/update verdict
      // reads them (NTS-582)
      return {
        records: result.records.map((record) => new DriverQueryRecord(record)),
        summary: summaryOf(result),
      }
    } catch (error) {
      // NTS-446: unclassified failures carry the failing statement and
      // redacted params; typed errors pass through with their own message
      throw withQueryContext(error, statement, parameters)
    }
  }

  async commit(): Promise<void> {
    try {
      await this.tx.commit()
    } finally {
      // NTS-576: the session closes even when the commit fails
      await closeQuietly(this.session)
    }
  }

  async rollback(): Promise<void> {
    try {
      await this.tx.rollback()
    } finally {
      await closeQuietly(this.session)
    }
  }
}

/**
ConnectionProvider over a neo4j-driver `Driver` (Bolt): Neo4j
Community/Enterprise, Aura, Memgraph, or `relate serve`.

Result values are normalised out of driver types (Node, Relationship,
Integer, temporal, Point) into the plain GraphNode/GraphRelationship
shapes; driver errors are mapped through the typed error taxonomy.
*/
export class Neo4jConnectionProvider implements ConnectionProvider {
  private readonly driver: Driver
  private readonly database: string | undefined

  constructor(driver: Driver, database?: string) {
    this.driver = driver
    this.database = database
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- driver session construction is synchronous; kept async so callers await it uniformly
  private async session(mode: AccessMode, database?: string): Promise<DriverSession> {
    const sessionDatabase = database ?? this.database

    return this.driver.session({
      ...(sessionDatabase !== undefined && { database: sessionDatabase }),
      defaultAccessMode: mode === 'READ' ? DriverSessionMode.READ : DriverSessionMode.WRITE,
    })
  }

  async run(
    statement: string,
    parameters?: QueryParameters,
    mode: AccessMode = 'WRITE',
    database?: string,
  ): Promise<QueryOutput> {
    try {
      // Inside the try so connect failures (session acquisition) are
      // classified with the statement's context too (NTS-442)
      const session = await this.session(mode, database)

      try {
        const result = await session.run(statement, parameters)

        return {
          records: result.records.map((record) => new DriverQueryRecord(record)),
          summary: summaryOf(result),
        }
      } finally {
        await closeQuietly(session)
      }
    } catch (error) {
      // NTS-446: statement + redacted params on unclassified failures
      throw withQueryContext(error, statement, parameters)
    }
  }

  async beginTransaction(
    mode: AccessMode = 'WRITE',
    database?: string,
  ): Promise<TransactionHandle> {
    try {
      const session = await this.session(mode, database)

      try {
        return new Neo4jTransactionHandle(session, session.beginTransaction())
      } catch (error) {
        // NTS-576: a failed begin must not leak its session
        await closeQuietly(session)

        throw error
      }
    } catch (error) {
      throw classifyError(error)
    }
  }

  async edition(): Promise<'enterprise' | 'community' | 'unknown'> {
    try {
      const output = await this.run('CALL dbms.components() YIELD edition RETURN edition')

      const value = output.records[0]?.get('edition')

      if (value === 'enterprise') {
        return 'enterprise'
      }

      return value === 'community' ? 'community' : 'unknown'
    } catch {
      return 'unknown'
    }
  }

  async close(): Promise<void> {
    await this.driver.close()
  }
}

/* eslint-enable unicorn/name-replacements -- file-scoped: only this Neo4j driver adapter may keep the product name */
