import type { ConnectionProvider, QueryOutput, Runner } from '../../driver/types.js'
import { rollbackAfterFailure } from '../../transaction/rollback.js'
import { THIS_NODE } from '../../constants.js'
import { hydrate } from '../../hydrate.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { PropertyType, isProjectedProperty } from '../../meta/property-schema.js'
import { getValueOrDefault } from '../../utilities.js'
import {
  versionBump,
  applyEmbeddings,
  applyInTransforms,
  modelPropertyValues,
  timestampProperty,
  versionProperty,
} from '../write-utilities.js'
import { validate } from '../../validation/index.js'
import { NeodeError } from '../../errors/index.js'
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
  return labels.length > 0 ? `:${labels.join(':')}` : ''
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
      values[property.getKey()] = value
    }
  }

  return values
}

/**
Validate a row and split it into the merge match (the merge fields —
unique, indexed or primary key properties — the row explicitly sets,
never default-resolved) and the remaining set values
(the merge-field semantics of mergeOn)
*/
export function processMergeRow(
  row: Record<string, unknown>,
  schema: EntitySchema,
): { match: Record<string, unknown>; set: Record<string, unknown> } {
  const mergeFields = getMergeFields(schema)
  const mergeKeys = new Set(mergeFields.map((property) => property.getKey()))

  // Match only on explicitly set merge fields: default-resolving them
  // (e.g. a fresh UUID per row) would never match anything
  const match: Record<string, unknown> = {}

  for (const property of mergeFields) {
    const key = property.getKey()

    if (Object.hasOwn(row, key) && row[key] !== undefined) {
      match[key] = row[key]
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

    if (value !== undefined) {
      set[property.getKey()] = value
    }
  }

  validate({ ...match, ...set }, schema)

  return { match, set }
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
export function buildCreateQuery(labels: string[], stamps: string[] = []): string {
  return [
    'UNWIND $rows AS row',
    `CREATE (${THIS_NODE}${labelPattern(labels)})`,
    [`SET ${THIS_NODE} += row`, ...stamps].filter((part) => part.length > 0).join(', '),
    `RETURN ${THIS_NODE}`,
  ].join('\n')
}

/**
UNWIND $rows AS row
MERGE (this:Label { key: row.key, ... })
ON CREATE SET this.createdAt = coalesce(row.createdAt, datetime())
SET this += row
SET this.updatedAt = coalesce(row.updatedAt, datetime())
RETURN this

`onCreateStamps` render in the ON CREATE SET clause, `stamps` in a plain
SET that applies to created and matched rows alike (NTS-165), and
`onMatchStamps` in an ON MATCH SET clause (NTS-158 — the version bump only
applies to matched rows).
*/
export function buildMergeQuery(
  labels: string[],
  matchKeys: string[],
  onCreateStamps: string[] = [],
  stamps: string[] = [],
  onMatchStamps: string[] = [],
): string {
  if (matchKeys.length === 0) {
    throw new NeodeError('mergeMany requires at least one match property')
  }

  const pattern = matchKeys.map((key) => `${key}: row.${key}`).join(', ')

  const output = [
    'UNWIND $rows AS row',
    `MERGE (${THIS_NODE}${labelPattern(labels)} { ${pattern} })`,
    ...(onCreateStamps.length > 0 ? [`ON CREATE SET ${onCreateStamps.join(', ')}`] : []),
    ...(onMatchStamps.length > 0 ? [`ON MATCH SET ${onMatchStamps.join(', ')}`] : []),
    [`SET ${THIS_NODE} += row`, ...stamps].filter((part) => part.length > 0).join(', '),
    `RETURN ${THIS_NODE}`,
  ]

  return output.join('\n')
}

/**
The server-side timestamp SET items for the bulk row alias (NTS-165): the
row's explicit value wins, otherwise the database clock stamps it
*/
function rowStamps(schema: EntitySchema, kind: 'createdAt' | 'updatedAt'): string[] {
  const property = timestampProperty(schema, kind)

  if (property === undefined) {
    return []
  }

  const key = property.getKey()

  return [`${THIS_NODE}.${key} = coalesce(row.${key}, datetime())`]
}

/**
The version SET item for the bulk row alias (NTS-158): the row's explicit
value wins, otherwise a created row starts at 0. Matched rows bump via the
ON MATCH clause (rowVersionBump).
*/
function rowVersionStamp(schema: EntitySchema): string[] {
  const property = versionProperty(schema)

  return property === undefined
    ? []
    : [`${THIS_NODE}.${property.getKey()} = coalesce(row.${property.getKey()}, 0)`]
}

/**
The version ON MATCH SET item for the bulk merge (NTS-158): matched rows
bump by exactly 1 (created rows take the ON CREATE stamp instead)
*/
function rowVersionBump(schema: EntitySchema): string[] {
  const property = versionProperty(schema)

  return property === undefined ? [] : [versionBump(THIS_NODE, property.getKey())]
}

/**
Bulk rows are transformed per row before the shared validate-and-reduce
pass: embedding sugar first (NTS-449), then `in` transforms — the same
order and semantics as the single create / merge paths. Each row is
copied, so the caller's records are left untouched.
*/
async function prepareRows(
  rows: Record<string, unknown>[],
  schema: EntitySchema,
): Promise<Record<string, unknown>[]> {
  return Promise.all(
    rows.map(async (row) => {
      const prepared = { ...row }

      await applyEmbeddings(schema, prepared)
      await applyInTransforms(schema, prepared)

      return prepared
    }),
  )
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
to property maps exactly like the single-create / merge paths
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
  relationship targets are not supported (they throw), defaults and
  validation behave exactly like create()
  */
  async createMany<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    rows: Record<string, unknown>[],
    options: BulkOptions = {},
  ): Promise<BulkChunk<T>[]> {
    // Embedding sugar + `in` transforms (NTS-449): user value -> stored
    // form, per row, before the shared validate-and-reduce pass
    const prepared = await prepareRows(rows, schema)

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
    const prepared = await prepareRows(rows, schema)

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
      [...rowStamps(schema, 'createdAt'), ...rowVersionStamp(schema)],
      rowStamps(schema, 'updatedAt'),
      rowVersionBump(schema),
    )

    // The MERGE pattern reads the match values off the row map
    const rowMaps = parts.map((part) => ({ ...part.set, ...part.match }))

    return this.writeChunks<T>(constructor, rowMaps, query, options)
  }
}
