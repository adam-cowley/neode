import type { ConnectionProvider, QueryOutput, Runner } from '../../driver/types.js'
import { rollbackAfterFailure } from '../../transaction/rollback.js'
import { THIS_NODE } from '../../constants.js'
import { hydrate } from '../../hydrate.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import {
  PropertyType,
  isProjectedProperty,
  type PropertySchema,
} from '../../meta/property-schema.js'
import { convertPropertyValue, getValueOrDefault } from '../../utilities.js'
import {
  versionBump,
  applyEmbeddings,
  applyFakeValues,
  applyInTransforms,
  deriveProperties,
  modelPropertyValues,
  timestampProperty,
  stampExpression,
  versionProperty,
} from '../write-utilities.js'
import { validate } from '../../validation/index.js'
import { ValidationError, type ValidationDetail } from '../../validation/validation-error.js'
import { NeodeError } from '../../errors/index.js'
import { quoteLabels } from '../../query/quote.js'
import { QueryService } from './query.service.js'
import { getMergeFields } from './merge.service.js'

/**
Rows per UNWIND statement / managed write transaction. Chunking keeps
each statement's parameter map within driver limits (the reason the
chunkSize option exists at all)
*/
export const DEFAULT_CHUNK_SIZE = 1000

/**
Property types that are never written as node properties
*/
const NON_WRITABLE_TYPES = new Set<PropertyType>([
  PropertyType.INTERNAL_ID,
  PropertyType.ALL_PROPERTIES,
  PropertyType.NODE,
])

export interface BulkOptions {
  /**
  Rows per statement and per write transaction (default 1000)
  */
  chunkSize?: number

  /**
  Per-call database override (a bare Runner runs in its own scope)
  */
  database?: string | undefined
}

/**
The result of one chunk: the rows attempted and the hydrated
created/merged entities, in row order
*/
export interface BulkChunk<T> {
  count: number
  entities: T[]
}

/**
Split rows into chunks of at most chunkSize
*/
export function chunk<T>(rows: T[], chunkSize: number): T[][] {
  requireChunkSize(chunkSize)

  const chunks: T[][] = []

  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize))
  }

  return chunks
}

function requireChunkSize(chunkSize: number): void {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new NeodeError(`chunkSize must be a positive integer, received ${String(chunkSize)}`)
  }
}

/**
Sorted copy of string values (code-unit order). `Array#toSorted` is outside
the ES2022 lib target and `Array#sort` is banned by lint, so this is a plain
insertion sort — the sorted lists are merge-field keys, a handful at most.
*/
function sortedCopy(values: string[]): string[] {
  const sorted: string[] = []

  for (const value of values) {
    const position = sorted.findIndex((existing) => value < existing)

    if (position === -1) {
      sorted.push(value)
    } else {
      sorted.splice(position, 0, value)
    }
  }

  return sorted
}

/**
True when the runner opens its own transactions (a ConnectionProvider)
rather than running in an already-open transaction's scope
*/
function isConnectionProvider(runner: Runner): runner is ConnectionProvider {
  return 'beginTransaction' in runner && typeof runner.beginTransaction === 'function'
}

/**
`:Label:Label` node pattern suffix for a schema's labels
*/
export function labelPattern(labels: string[]): string {
  return labels.length > 0 ? `:${quoteLabels(labels)}` : ''
}

/**
Convert a value through the schema unless it targets an iso-string
timestamp property and is already a string (NTS-638): those properties
store and match the string form (NTS-612), and a temporal value would
never equal it
*/
function convertValueForStorage(value: unknown, property: PropertySchema): unknown {
  const isStoredString = property.getTimestampFormat() === 'iso-string' && typeof value === 'string'

  return isStoredString ? value : convertPropertyValue(value, property)
}

/**
Validate a row exactly like the single-create path (defaults resolved,
Zod rules applied) and reduce it to the plain property map the UNWIND
statement writes
*/
export function processCreateRow(
  row: Record<string, unknown>,
  schema: EntitySchema,
): Record<string, unknown> {
  // Bulk rows are flat: a declared relationship key would otherwise be
  // silently dropped
  const relationship = schema
    .getRelationships()
    .find((candidate) => row[candidate.getKey()] !== undefined && row[candidate.getKey()] !== null)

  if (relationship) {
    throw new NeodeError(
      `createMany does not support nested relationship values ("${relationship.getKey()}" given); ` +
        'create relationships separately',
    )
  }

  validate(modelPropertyValues(row, schema), schema)

  const values: Record<string, unknown> = {}

  for (const property of schema.getProperties()) {
    if (NON_WRITABLE_TYPES.has(property.getType()) || isProjectedProperty(property)) {
      continue
    }

    const value = getValueOrDefault(row, property, schema)

    // Like the single-create pattern: unset and null properties are skipped
    if (value !== undefined && value !== null) {
      values[property.getKey()] = convertPropertyValue(value, property)
    }
  }

  return values
}

/**
Properties a matched row must never overwrite (NTS-580): the same set
update() guards — primary key, protected, readonly, @CreatedAt and the
library-managed @Version. Their values apply on create only.
*/
function isMatchGuarded(property: PropertySchema): boolean {
  return (
    property.isPrimaryKey() ||
    property.isProtected() ||
    property.isReadonly() ||
    property.isCreatedAt() ||
    property.isVersion()
  )
}

/**
Validate a row and split it into the merge match (the merge fields —
unique, indexed or primary key properties — the row explicitly sets,
never default-resolved), the set values applied on every write, and the
`create` values (guarded properties, NTS-580) applied to created nodes
only. A supplied @Version is dropped: the library owns the counter.
*/
export function processMergeRow(
  row: Record<string, unknown>,
  schema: EntitySchema,
): {
  match: Record<string, unknown>
  set: Record<string, unknown>
  create: Record<string, unknown>
} {
  const mergeFields = getMergeFields(schema)
  const mergeKeys = new Set(mergeFields.map((property) => property.getKey()))

  // Match only on explicitly set merge fields: default-resolving them
  // (e.g. a fresh UUID per row) would never match anything
  const match: Record<string, unknown> = {}

  for (const property of mergeFields) {
    const key = property.getKey()

    if (Object.hasOwn(row, key) && row[key] !== undefined) {
      // NTS-637: match keys go through the same conversion as set values —
      // file sources (CSV/JSON) deliver strings, and a MERGE pattern value
      // must equal the stored (converted) form to match at all
      match[key] = convertValueForStorage(row[key], property)
    }
  }

  if (Object.keys(match).length === 0) {
    throw new NeodeError(
      'mergeMany requires every row to set at least one merge field ' +
        `(unique, indexed or primary key properties): ${mergeFields
          .map((property) => property.getKey())
          .join(', ')}`,
    )
  }

  const set: Record<string, unknown> = {}
  const create: Record<string, unknown> = {}

  for (const property of schema.getProperties()) {
    if (
      NON_WRITABLE_TYPES.has(property.getType()) ||
      isProjectedProperty(property) ||
      // Match keys ride in the match map; they must never be
      // default-resolved into the set map
      mergeKeys.has(property.getKey())
    ) {
      continue
    }

    const value = getValueOrDefault(row, property, schema)

    if (value === undefined || property.isVersion()) {
      continue
    }

    const converted = convertPropertyValue(value, property)

    if (isMatchGuarded(property)) {
      create[property.getKey()] = converted
    } else {
      set[property.getKey()] = converted
    }
  }

  validate({ ...match, ...set, ...create }, schema)

  return { match, set, create }
}

/**
UNWIND $rows AS row
CREATE (this:Label)
SET this += row
SET this.createdAt = coalesce(row.createdAt, datetime())
RETURN this

`stamps` are the server-side timestamp SET items (NTS-165); each reads the
row's explicit value first (`coalesce`), so an explicitly provided
timestamp wins over the database clock.
*/
export function buildCreateQuery(
  labels: string[],
  stamps: string[] = [],
  derivedSets: string[] = [],
): string {
  return [
    'UNWIND $rows AS row',
    `CREATE (${THIS_NODE}${labelPattern(labels)})`,
    [`SET ${THIS_NODE} += row`, ...stamps].filter((part) => part.length > 0).join(', '),
    // Derived sets are their own clause: the embedded Relate engine drops
    // the trailing items of a SET clause that mixes the `+=` map form with
    // property assignments (NTS-569)
    ...(derivedSets.length > 0 ? [`SET ${derivedSets.join(', ')}`] : []),
    `RETURN ${THIS_NODE}`,
  ].join('\n')
}

/**
UNWIND $rows AS item
WITH item.row AS row, item.create AS created
MERGE (this:Label { key: row.key, ... })
ON CREATE SET this.createdAt = coalesce(created.createdAt, datetime())
SET this += row
SET this.updatedAt = coalesce(row.updatedAt, datetime())
RETURN this

`onCreateStamps` render in the ON CREATE SET clause, `stamps` in a plain
SET that applies to created and matched rows alike (NTS-165), and
`onMatchStamps` in an ON MATCH SET clause (NTS-158 — the version bump only
applies to matched rows). Each input row is `{ row, create }` (NTS-580):
`row` is the match + set map (`+=`), `create` holds the guarded values
(createdAt, readonly, protected) that only a created node takes — so a
matched node's version / createdAt / readonly values cannot be overridden.
*/
export function buildMergeQuery(
  labels: string[],
  matchKeys: string[],
  onCreateStamps: string[] = [],
  stamps: string[] = [],
  onMatchStamps: string[] = [],
  derivedSets: string[] = [],
): string {
  if (matchKeys.length === 0) {
    throw new NeodeError('mergeMany requires at least one match property')
  }

  const pattern = matchKeys.map((key) => `${key}: row.${key}`).join(', ')

  const output = [
    'UNWIND $rows AS item',
    'WITH item.row AS row, item.create AS created',
    `MERGE (${THIS_NODE}${labelPattern(labels)} { ${pattern} })`,
    ...(onCreateStamps.length > 0 ? [`ON CREATE SET ${onCreateStamps.join(', ')}`] : []),
    ...(onMatchStamps.length > 0 ? [`ON MATCH SET ${onMatchStamps.join(', ')}`] : []),
    [`SET ${THIS_NODE} += row`, ...stamps].filter((part) => part.length > 0).join(', '),
    // Derived sets are their own clause: the embedded Relate engine drops
    // the trailing items of a SET clause that mixes the `+=` map form with
    // property assignments (NTS-569)
    ...(derivedSets.length > 0 ? [`SET ${derivedSets.join(', ')}`] : []),
    `RETURN ${THIS_NODE}`,
  ]

  return output.join('\n')
}

/**
The server-side timestamp SET items for the bulk row alias (NTS-165): the
row's explicit value wins, otherwise the database clock stamps it
*/
function rowStamps(schema: EntitySchema, kind: 'createdAt' | 'updatedAt', alias = 'row'): string[] {
  const property = timestampProperty(schema, kind)

  if (property === undefined) {
    return []
  }

  const key = property.getKey()

  return [`${THIS_NODE}.${key} = coalesce(${alias}.${key}, ${stampExpression(property)})`]
}

/**
The version SET item for the bulk row alias (NTS-158): the row's explicit
value wins, otherwise a created row starts at 0. Matched rows bump via the
ON MATCH clause (rowVersionBump).
*/
function rowVersionStamp(schema: EntitySchema, isExplicit = true): string[] {
  const property = versionProperty(schema)

  if (property === undefined) {
    return []
  }

  // mergeMany drops a supplied version (NTS-580): a created row is always 0
  return [
    `${THIS_NODE}.${property.getKey()} = ${isExplicit ? `coalesce(row.${property.getKey()}, 0)` : '0'}`,
  ]
}

/**
ON CREATE SET items for the guarded properties other than the timestamp and
version stamps (NTS-580): read off the row's `create` map, so a matched
node never takes them
*/
function createOnlySets(schema: EntitySchema): string[] {
  return schema
    .getProperties()
    .filter(
      (property) =>
        isMatchGuarded(property) &&
        !property.isCreatedAt() &&
        !property.isVersion() &&
        !NON_WRITABLE_TYPES.has(property.getType()) &&
        !isProjectedProperty(property),
    )
    .map((property) => `${THIS_NODE}.${property.getKey()} = created.${property.getKey()}`)
}

/**
The version ON MATCH SET item for the bulk merge (NTS-158): matched rows
bump by exactly 1 (created rows take the ON CREATE stamp instead)
*/
function rowVersionBump(schema: EntitySchema): string[] {
  const property = versionProperty(schema)

  // A full assignment: the bare bump expression is only valid inside
  // setExpr(), where the target is part of the clause (NTS-528)
  return property === undefined
    ? []
    : [`${THIS_NODE}.${property.getKey()} = ${versionBump(THIS_NODE, property.getKey())}`]
}

/**
Bulk rows are transformed per row before the shared validate-and-reduce
pass: `fake` generators first (NTS-608 — the single-create order: fake
runs before transforms and validation), then embedding sugar (NTS-449),
then `in` transforms — the same order and semantics as the single create /
merge paths. Each row is copied, so the caller's records are left
untouched.

Unlike the FactoryBuilder (NTS-444), each row's `fake` generator runs
independently: unique + `fake` properties are NOT guaranteed distinct
across rows — use fake generators that are DB-safe (e.g. random UUIDs).

Rows run through a bounded-concurrency pass (NTS-597): an embedding
provider is a remote service, and one call per row all at once would
overwhelm it.
*/
const MAX_PREPARE_CONCURRENCY = 8

/**
Map over items with at most `limit` tasks in flight, preserving item
order in the results.
*/
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []

  let next = 0

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next

      next += 1

      const item = items[index]

      if (item !== undefined) {
        results[index] = await task(item)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))

  return results
}

export async function prepareRows(
  rows: Record<string, unknown>[],
  schema: EntitySchema,
): Promise<{ rows: Record<string, unknown>[]; derivedSets: string[] }> {
  const derivedKeys = new Map<string, string>()

  const prepared = await mapWithConcurrency(rows, MAX_PREPARE_CONCURRENCY, async (row) => {
    const copy = { ...row }

    // Resolve `fake` generators first (NTS-608), the single-create order:
    // fake runs before transforms and validation, so validation and the
    // write see the same value
    applyFakeValues(schema, copy)

    await applyEmbeddings(schema, copy)

    // Stored derived properties (NTS-569): compute-side values land on
    // the row and flow through the reduce like hand-set values. A
    // cypher-side set from any row becomes a statement-level SET item —
    // the expression reads each row's node values, so it is correct per
    // row; rows that kept an explicit value are protected by the
    // coalesce on the row below.
    const { cypherSets } = deriveProperties(schema, copy)

    for (const { key, cypher } of cypherSets) {
      derivedKeys.set(key, cypher)
    }

    await applyInTransforms(schema, copy)

    return copy
  })

  const derivedSets = [...derivedKeys].map(
    ([key, cypher]) => `${THIS_NODE}.${key} = coalesce(row.${key}, ${cypher})`,
  )

  return { rows: prepared, derivedSets }
}

/**
The result of mapping one source row (a CSV / JSON / NDJSON record)
through the model's write pipeline
*/
export type RowPropertiesResult =
  | { ok: true; properties: Record<string, unknown> }
  | { ok: false; errors: ValidationDetail[] }

export interface RowToPropertiesOptions {
  /**
  Source-key -> property-key renames (e.g. CSV headers that do not match
  the model's property names), applied before the pipeline runs
  */
  map?: Record<string, string>
}

/**
Map one source row to the property map createMany() / mergeMany() take —
the batch-import row pipeline, non-throwing. Renames apply first, then the
single-create order (fake -> embeddings -> derived -> transforms, NTS-608/
449/569), then conversion through the schema BEFORE validation: file
sources deliver strings (every CSV cell is one), and a numeric string must
not fail its type rule. Unset properties resolve defaults and fakes
exactly like create().

Returns `{ ok: false, errors }` instead of throwing — a ValidationError
carries every failing check; a value its type cannot absorb (nested
relationship values, `age: "x"`) becomes one synthetic detail. The
`properties` of an ok result feed createMany()/mergeMany() directly:
already-converted driver values pass through those pipelines unchanged.
*/
export async function rowToProperties(
  schema: EntitySchema,
  row: Record<string, unknown>,
  options: RowToPropertiesOptions = {},
): Promise<RowPropertiesResult> {
  const map = options.map

  const source =
    map === undefined
      ? row
      : Object.fromEntries(Object.entries(row).map(([key, value]) => [map[key] ?? key, value]))

  try {
    const { rows } = await prepareRows([source], schema)

    const prepared = rows[0] ?? {}

    // Conversion is idempotent (driver values pass through), so the
    // validate-and-reduce below re-converts as a no-op
    for (const property of schema.getProperties()) {
      const key = property.getKey()

      if (Object.hasOwn(prepared, key)) {
        prepared[key] = convertValueForStorage(prepared[key], property)
      }
    }

    return { ok: true, properties: processCreateRow(prepared, schema) }
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, errors: error.details }
    }

    return {
      ok: false,
      errors: [
        {
          message: error instanceof Error ? error.message : String(error),
          path: [],
          type: 'NeodeError',
        },
      ],
    }
  }
}

/**
Run one unit of work per chunk: a managed WRITE transaction when the
runner is a ConnectionProvider, or the runner's own scope when it is an
already-open transaction
*/
async function inWriteTransaction(
  runner: Runner,
  database: string | undefined,
  work: (tx: Runner) => Promise<QueryOutput>,
): Promise<QueryOutput> {
  if (!isConnectionProvider(runner)) {
    return work(runner)
  }

  const tx = await runner.beginTransaction('WRITE', database)

  try {
    const output = await work(tx)

    await tx.commit()

    return output
  } catch (error) {
    return await rollbackAfterFailure(tx, error)
  }
}

/**
Bulk CREATE and MERGE via UNWIND: one managed write transaction per
chunk, one UNWIND statement per transaction, rows validated and reduced
to property maps exactly like the single-create / merge paths — `fake`
generators included (NTS-608), each row's run independently: unique +
`fake` properties are NOT guaranteed distinct across rows (see
prepareRows).

Chunks commit SEPARATELY (NTS-597): a failure partway through leaves the
earlier chunks committed — bulk writes are not atomic across chunks. Row
preparation bounds its embedding-provider calls at MAX_PREPARE_CONCURRENCY
in flight.
*/
export class BulkService extends QueryService {
  private async writeChunks<T>(
    constructor: new (...arguments_: never[]) => T,
    rowMaps: Record<string, unknown>[],
    query: string,
    options: BulkOptions,
  ): Promise<BulkChunk<T>[]> {
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE

    const chunks: BulkChunk<T>[] = []

    for (const rows of chunk(rowMaps, chunkSize)) {
      const output = await inWriteTransaction(this.runner, options.database, async (tx) =>
        tx.run(query, { rows }),
      )

      chunks.push({
        count: rows.length,
        entities: hydrate<T>(constructor, output, THIS_NODE),
      })
    }

    return chunks
  }

  /**
  CREATE every row in chunks. Rows are flat property records: nested
  relationship targets are not supported (they throw), defaults, fakes
  and validation behave exactly like create() — unique + `fake`
  properties are not guaranteed distinct across rows
  */
  async createMany<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    rows: Record<string, unknown>[],
    options: BulkOptions = {},
  ): Promise<BulkChunk<T>[]> {
    // Embedding sugar + `in` transforms (NTS-449): user value -> stored
    // form, per row, before the shared validate-and-reduce pass
    const { rows: prepared, derivedSets } = await prepareRows(rows, schema)

    const rowMaps = prepared.map((row) => processCreateRow(row, schema))

    // shortcut: vector properties persist as plain SET values through the
    // UNWIND row map (indexable, not the packed vector format) — switch to
    // per-row procedure calls when bulk storage must be space-efficient too
    return this.writeChunks<T>(
      constructor,
      rowMaps,
      buildCreateQuery(schema.getLabels(), [
        ...rowStamps(schema, 'createdAt'),
        ...rowStamps(schema, 'updatedAt'),
        ...rowVersionStamp(schema),
        ...derivedSets,
      ]),
      options,
    )
  }

  /**
  MERGE every row in chunks on the model's merge fields (the unique,
  indexed or primary key properties each row explicitly sets): rows
  matching an existing node update it (`+=`), the rest are created.
  Every row must merge on the same merge fields
  */
  async mergeMany<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    rows: Record<string, unknown>[],
    options: BulkOptions = {},
  ): Promise<BulkChunk<T>[]> {
    // Embedding sugar + `in` transforms (NTS-449): user value -> stored
    // form, per row, before the match/set split
    const { rows: prepared, derivedSets } = await prepareRows(rows, schema)

    const parts = prepared.map((row) => processMergeRow(row, schema))

    const firstPart = parts[0]

    if (firstPart === undefined) {
      return []
    }

    const matchKeys = sortedCopy(Object.keys(firstPart.match))

    for (const [index, part] of parts.entries()) {
      const keys = sortedCopy(Object.keys(part.match))

      if (keys.join(',') !== matchKeys.join(',')) {
        throw new NeodeError(
          `mergeMany requires every row to merge on the same merge fields: ` +
            `row 0 merges on ${matchKeys.join(', ')}, row ${String(index)} on ${keys.join(', ')}`,
        )
      }
    }

    const query = buildMergeQuery(
      schema.getLabels(),
      matchKeys,
      [
        ...rowStamps(schema, 'createdAt', 'created'),
        ...rowVersionStamp(schema, false),
        ...createOnlySets(schema),
      ],
      rowStamps(schema, 'updatedAt'),
      rowVersionBump(schema),
      derivedSets,
    )

    // The MERGE pattern reads the match values off the row map
    const rowMaps = parts.map((part) => ({
      row: { ...part.set, ...part.match },
      create: part.create,
    }))

    return this.writeChunks<T>(constructor, rowMaps, query, options)
  }
}
