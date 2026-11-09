import type { Runner } from '../../driver/types.js'
import { hydrate } from '../../hydrate.js'
import { EntitySchema } from '../../meta/entity/entity-schema.js'
import { getModel } from '../../meta/index.js'
import type { Newable } from '../../meta/newable.js'
import { isConstructorOf } from '../type-guards.js'
import { isTransientError, NeodeError } from '../../errors/index.js'
import { readFilterFragment, type ReadFilterOptions } from './filters.js'

/**
The message of a thrown value (thrown non-Errors have none)
*/
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
A hydrated entity with the relevance score of the index that matched it
*/
export interface ScoredEntity<T> {
  entity: T
  score: number
}

/**
A registered model class or its EntitySchema
*/
export type ModelInput = Newable | EntitySchema

export const resolveModel = (model: ModelInput): Newable =>
  model instanceof EntitySchema ? model.getConstructor() : model

const NODE_ALIAS = 'node'

const requireString = (value: string, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Cannot run a full-text search: ${label} must be a non-empty string`)
  }

  return value
}

/**
Full-text search over a full-text index
(`CALL db.index.fulltext.queryNodes`), returning hydrated entities with
their relevance score, best match first.

The query string is bound as a parameter, so Lucene syntax characters in it
are still parsed as such — pass user text through `toFulltextQuery` first.

NTS-162 — the model's named read filters apply (a `WHERE` after the YIELD);
`filters.withoutFilters` disables names for this call.
*/
export async function search<T>(
  runner: Runner,
  model: ModelInput,
  indexName: string,
  query: string,
  limit?: number,
  filters?: ReadFilterOptions,
): Promise<ScoredEntity<T>[]> {
  requireString(indexName, 'index name')
  requireString(query, 'query')

  let statement =
    'CALL db.index.fulltext.queryNodes($index, $q) ' +
    `YIELD ${NODE_ALIAS}, score ` +
    `RETURN ${NODE_ALIAS}, score ORDER BY score DESC`

  const parameters: Record<string, unknown> = { index: indexName, q: query }

  if (limit !== undefined) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new TypeError('Cannot run a full-text search: limit must be a positive integer')
    }

    // Inlined, not a parameter: the driver serialises JS numbers as
    // floats and Neo4j rejects LIMIT 1.0 (22N03). The value is a
    // validated safe integer, so interpolation is safe.
    statement += ` LIMIT ${String(limit)}`
  }

  const constructor = resolveModel(model)

  // resolveModel guarantees a constructor; the guard names the constructed
  // type for the generic hydrate call
  if (!isConstructorOf<T>(constructor)) {
    throw new TypeError('Cannot run a full-text search: the model is not a constructor')
  }

  // NTS-162 — named read filters as a WHERE over the YIELDed rows
  const schema = model instanceof EntitySchema ? model : getModel(constructor)

  if (schema instanceof EntitySchema) {
    const { fragment, parameters: filterParameters } = readFilterFragment(schema, NODE_ALIAS, filters)

    if (fragment !== undefined) {
      // Replacer function: the fragment carries `$params` and must not
      // dance with replacement-pattern semantics
      statement = statement.replace(
        `RETURN ${NODE_ALIAS}, score`,
        () => `WHERE ${fragment} RETURN ${NODE_ALIAS}, score`,
      )

      Object.assign(parameters, filterParameters)
    }
  }

  const output = await (async () => {
    try {
      return await runner.run(statement, parameters)
    } catch (error) {
      // Transient failures keep their typed identity — retry logic keys
      // on it (NTS-446)
      if (isTransientError(error)) {
        throw error
      }

      throw new NeodeError(
        `Full-text search over index "${indexName}" failed — ${errorMessage(error)}. ` +
          'Ensure the full-text index exists — did you run installSchema()?',
        { cause: error instanceof Error ? error : undefined },
      )
    }
  })()

  const nodeRows = output.records.filter((row) => hasNode(row))

  // hydrate() keeps only records carrying a node under the alias, in order
  const entities = hydrate<T>(constructor, output, NODE_ALIAS)

  return entities.map((entity, index) => {
    const row = nodeRows[index]

    if (row === undefined) {
      throw new NeodeError('search result rows and hydrated entities are misaligned')
    }

    return { entity, score: scoreOf(row) }
  })
}

/**
True while the row carries a node value under the alias
*/
function hasNode(row: { has(key: string): boolean; get(key: string): unknown }): boolean {
  if (!row.has(NODE_ALIAS)) {
    return false
  }

  const node: unknown = row.get(NODE_ALIAS)

  return node !== null && node !== undefined
}

/**
The relevance score of a row (a float from the backend)
*/
function scoreOf(row: { get(key: string): unknown }): number {
  const score: unknown = row.get('score')

  return typeof score === 'number' ? score : Number(score)
}
