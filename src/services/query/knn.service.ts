import type { Runner } from '../../driver/types.js'
import { quote } from '../../query/quote.js'
import { getModel } from '../../meta/index.js'
import { EntitySchema } from '../../meta/entity/entity-schema.js'
import { type ModelInput, resolveModel } from './search.service.js'
import { isConstructorOf } from '../type-guards.js'
import { isTransientError, NeodeError } from '../../errors/index.js'
import { readFilterFragment, type ReadFilterOptions } from './filters.js'
import { type ScoredEntity, shapeScoredRows } from './shape.js'

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
The binding variable of the SEARCH clause form's MATCH — the filter
fragment must reference IT there: `node` is only the RETURN column alias
in that form, not a variable in scope (NTS-584).
*/
const SEARCH_BINDING = 'n'

/**
NTS-584 — filtered searches over-fetch past the index's top-k so the
post-filter still fills k: each round fetches this factor more, and the
round cap bounds the statement count (k, 2k, 4k — three statements at
most).
*/
const OVERFETCH_FACTOR = 2
const OVERFETCH_ROUNDS = 3

/**
The Cypher 25 SEARCH clause form — the procedure is deprecated on Cypher 25
backends. The index name cannot be bound as a parameter in this form, so it
is inlined (backtick-escaped).
*/
export function knnSearchClauseStatement(label: string, indexName: string): string {
  return (
    `MATCH (${SEARCH_BINDING}:${quote(label)}) ` +
    `SEARCH ${SEARCH_BINDING} IN (VECTOR INDEX ${quote(indexName)} FOR $vector LIMIT $k) ` +
    `SCORE AS score ` +
    `RETURN ${SEARCH_BINDING} AS ${NODE_ALIAS}, score ORDER BY score DESC`
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

NTS-162 — the model's named read filters apply to both query forms (a
`WHERE` over the matched / YIELDed rows); `filters.withoutFilters`
disables names for this call.

NTS-584 — the filters are a post-filter over the index's top-k: the
SEARCH clause's in-index `WHERE` only takes property predicates over
properties registered as additional filter properties on the vector
index (which neode's index definitions never declare) and has no label
predicates, so the soft-delete filter can never go there. Filtered
searches therefore over-fetch round over round until k rows survive the
filters or the round cap gives up — k is filled whenever that many valid
neighbours exist.
*/
export async function knn<T>(
  runner: Runner,
  model: ModelInput,
  indexName: string,
  vector: number[],
  k: number,
  mode: KnnMode = 'auto',
  filters?: ReadFilterOptions,
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

  // NTS-162 — named read filters over the scored rows. The procedure form
  // yields the node as `node` (the WHERE goes after the YIELD); the
  // SEARCH-clause form binds the MATCH variable `n` — there the fragment
  // must reference `n`, `node` is only the RETURN alias (NTS-584).
  // NTS-584 — the filters stay a POST-filter over the top-k rows: the
  // SEARCH clause's in-index WHERE only accepts property predicates over
  // properties the vector index declares as additional filter properties
  // (the server rejects anything else 22ND3) and has no label predicates,
  // so the soft-delete filter can never go there. To keep k a guarantee
  // instead of a ceiling, filtered searches over-fetch: the fetch grows
  // round over round until the surviving rows fill k or the round cap
  // gives up.
  const runForm = async (statement: string, alias: string): Promise<ScoredEntity<T>[]> => {
    const { fragment, parameters: filterParameters } = readFilterFragment(schema, alias, filters)

    if (fragment !== undefined) {
      Object.assign(parameters, filterParameters)
    }

    const decorate = (text: string): string => {
      if (fragment === undefined) {
        return text
      }

      // Replacer functions: the fragment carries `$params` and must not
      // dance with replacement-pattern semantics
      return text.includes('YIELD')
        ? text.replace(
            `RETURN ${NODE_ALIAS}, score`,
            () => `WHERE ${fragment} RETURN ${NODE_ALIAS}, score`,
          )
        : text.replace(`SCORE AS score `, () => `SCORE AS score WHERE ${fragment} `)
    }

    const filteredStatement = decorate(statement)

    // Unfiltered, the index's top-k is the answer in one round
    if (fragment === undefined) {
      const output = await runner.run(filteredStatement, parameters)

      return shapeScoredRows<T>(output.records, constructor, NODE_ALIAS)
    }

    let fetch = k
    let best: ScoredEntity<T>[] = []

    for (let round = 0; round < OVERFETCH_ROUNDS; round += 1) {
      const output = await runner.run(filteredStatement, { ...parameters, k: fetch })
      const rows = shapeScoredRows<T>(output.records, constructor, NODE_ALIAS)

      // The widest round wins: the index's top-N grows with N, but the
      // approximate search can fluctuate just below k — never lose an
      // earlier round's rows to a smaller later round
      if (rows.length > best.length) {
        best = rows
      }

      if (best.length >= k) {
        break
      }

      fetch *= OVERFETCH_FACTOR
    }

    return best.slice(0, k)
  }

  if (mode === 'procedure') {
    return runWithIndexHint(indexName, async () => runForm(knnProcedureStatement(), NODE_ALIAS))
  }

  if (mode === 'search-clause') {
    return runWithIndexHint(indexName, async () =>
      runForm(knnSearchClauseStatement(label, indexName), SEARCH_BINDING),
    )
  }

  let searchClauseError: unknown

  try {
    return await runForm(knnSearchClauseStatement(label, indexName), SEARCH_BINDING)
  } catch (error) {
    searchClauseError = error
  }

  try {
    return await runForm(knnProcedureStatement(), NODE_ALIAS)
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
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
