import type { Runner } from '../../driver/types.js'
import { quote } from '../../query/quote.js'
import { hydrate } from '../../hydrate.js'
import { getModel } from '../../meta/index.js'
import { EntitySchema } from '../../meta/entity/entity-schema.js'
import { type ScoredEntity, type ModelInput, resolveModel } from './search.service.js'
import { isConstructorOf } from '../type-guards.js'
import { isTransientError, NeodeError } from '../../errors/index.js'

/**
Which query form to use for the kNN search
*/
export type KnnMode =
  /**
  Try the Cypher 25 `SEARCH` clause, fall back to the procedure (default)
  */
  | 'auto'
  /**
  Cypher 25 `SEARCH ... IN (VECTOR INDEX ...)` clause only
  */
  | 'search-clause'
  /**
  `CALL db.index.vector.queryNodes(...)` procedure only
  */
  | 'procedure'

const NODE_ALIAS = 'node'

/**
The Cypher 25 SEARCH clause form — the procedure is deprecated on Cypher 25
backends. The index name cannot be bound as a parameter in this form, so it
is inlined (backtick-escaped).
*/
export function knnSearchClauseStatement(label: string, indexName: string): string {
  return (
    `MATCH (n:${quote(label)}) ` +
    `SEARCH n IN (VECTOR INDEX ${quote(indexName)} FOR $vector LIMIT $k) ` +
    `SCORE AS score ` +
    `RETURN n AS ${NODE_ALIAS}, score ORDER BY score DESC`
  )
}

/**
The db.index.vector.queryNodes procedure form, supported on Neo4j 5.11+
*/
export function knnProcedureStatement(): string {
  return (
    `CALL db.index.vector.queryNodes($index, $k, $vector) ` +
    `YIELD ${NODE_ALIAS}, score ` +
    `RETURN ${NODE_ALIAS}, score ORDER BY score DESC`
  )
}

/**
k-nearest-neighbour search over a vector index, returning hydrated
entities with their similarity score, best match first.

With the default `auto` mode the Cypher 25 `SEARCH` clause is attempted
first and the queryNodes procedure is used as a fallback; when the backend
supports neither a combined error is raised.
*/
export async function knn<T>(
  runner: Runner,
  model: ModelInput,
  indexName: string,
  vector: number[],
  k: number,
  mode: KnnMode = 'auto',
): Promise<ScoredEntity<T>[]> {
  if (typeof indexName !== 'string' || indexName.length === 0) {
    throw new TypeError('Cannot run a kNN search: index name must be a non-empty string')
  }

  if (
    !Array.isArray(vector) ||
    vector.length === 0 ||
    vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new TypeError(
      'Cannot run a kNN search: vector must be a non-empty array of finite numbers',
    )
  }

  if (!Number.isSafeInteger(k) || k <= 0) {
    throw new TypeError('Cannot run a kNN search: k must be a positive integer')
  }

  // The label scopes the MATCH; a vector index itself targets one label
  const schema = model instanceof EntitySchema ? model : getModel(model)

  if (!(schema instanceof EntitySchema)) {
    throw new TypeError(
      'Cannot run a kNN search: no registered model found for the given constructor',
    )
  }

  const label = schema.getLabels()[0]

  if (label === undefined) {
    throw new NeodeError('Cannot run a kNN search: the schema has no label to match against')
  }

  const constructor = resolveModel(model)

  // resolveModel guarantees a constructor; the guard names the constructed
  // type for the generic hydrate call
  if (!isConstructorOf<T>(constructor)) {
    throw new TypeError('Cannot run a kNN search: the model is not a constructor')
  }

  const parameters = { index: indexName, k, vector }

  const runForm = async (statement: string): Promise<ScoredEntity<T>[]> => {
    const output = await runner.run(statement, parameters)

    const nodeRows = output.records.filter((row) => hasNode(row))

    // hydrate() keeps only records carrying a node under the alias, in order
    const entities = hydrate<T>(constructor, output, NODE_ALIAS)

    return entities.map((entity, index) => {
      const row = nodeRows[index]

      if (row === undefined) {
        throw new NeodeError('kNN result rows and hydrated entities are misaligned')
      }

      return { entity, score: scoreOf(row) }
    })
  }

  if (mode === 'procedure') {
    return runWithIndexHint(indexName, async () => runForm(knnProcedureStatement()))
  }

  if (mode === 'search-clause') {
    return runWithIndexHint(indexName, async () =>
      runForm(knnSearchClauseStatement(label, indexName)),
    )
  }

  let searchClauseError: unknown

  try {
    return await runForm(knnSearchClauseStatement(label, indexName))
  } catch (error) {
    searchClauseError = error
  }

  try {
    return await runForm(knnProcedureStatement())
  } catch (procedureError) {
    throw new NeodeError(
      'Cannot run a kNN search: the backend supports neither the Cypher 25 SEARCH clause ' +
        `(${errorMessage(searchClauseError)}) ` +
        `nor the db.index.vector.queryNodes procedure (${errorMessage(procedureError)}). ` +
        'Ensure the vector index exists — did you run installSchema()?',
      { cause: procedureError instanceof Error ? procedureError : undefined },
    )
  }
}

/**
Run one kNN query form, naming the index and the installSchema() fix when
the backend rejects the statement (most commonly: the index does not
exist yet). Transient failures keep their typed identity — retry logic
keys on it (NTS-446).
*/
async function runWithIndexHint<T>(
  indexName: string,
  run: () => Promise<ScoredEntity<T>[]>,
): Promise<ScoredEntity<T>[]> {
  try {
    return await run()
  } catch (error) {
    if (isTransientError(error)) {
      throw error
    }

    throw new NeodeError(
      `kNN search over index "${indexName}" failed — ${errorMessage(error)}. ` +
        'Ensure the vector index exists — did you run installSchema()?',
      { cause: error instanceof Error ? error : undefined },
    )
  }
}

/**
The message of a thrown value (thrown non-Errors have none)
*/

/**
The message of a thrown value (thrown non-Errors have none)
*/
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
The similarity score of a row (a float from the backend)
*/
function scoreOf(row: { get(key: string): unknown }): number {
  const score: unknown = row.get('score')

  return typeof score === 'number' ? score : Number(score)
}
