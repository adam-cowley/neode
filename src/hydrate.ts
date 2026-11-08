import type {
  HydrateQueryOptions,
  QueryOutput,
  QueryParams as QueryParameters,
  QueryRecord,
} from './driver/types.js'
import { jsonSafeRecord } from './driver/json-safe.js'
import { getModel, getModels } from './meta/index.js'
import { isGraphNode } from './services/type-guards.js'
import type { EntitySchema } from './meta/entity/entity-schema.js'
import { type EagerRelationship, hydrateNode } from './utilities.js'
import type { WithMethods } from './entity-methods.js'
import { NeodeError } from './errors/index.js'
import { Collection } from './collection.js'

const DEFAULT_ALIAS = 'this'

function requireSchema(constructor: new (...arguments_: never[]) => unknown): EntitySchema {
  const model: unknown = constructor
  const schema = getModel(model)

  if (!schema) {
    const name = constructor.name === '' ? 'unknown' : constructor.name

    throw new NeodeError(
      `Couldn't find a model for "${name}". Register it with @NodeEntity or defineModel() first.` +
        ` Registered model(s) are: ${Array.from(getModels().keys(), (model) => model.name)
          .filter((modelName) => modelName !== '')
          .join(', ')}`,
    )
  }

  return schema
}

/**
Extra record columns (every key except the node alias) as the eager values
hydrateNode understands: one legacy eager entry per column, whose node is
the column value
*/
function eagerColumns(row: QueryRecord, alias: string): Record<string, EagerRelationship[]> {
  const entries: [string, EagerRelationship[]][] = []

  for (const key of row.keys) {
    if (key === alias) {
      continue
    }

    const value: unknown = row.get(key)

    if (!isGraphNode(value)) {
      continue
    }

    entries.push([key, [{ other: { node: value } }]])
  }

  return Object.fromEntries(entries)
}

/**
Hydrate a raw query result (as returned by readCypher/writeCypher or
Builder#execute) into typed entities: each record's `alias` column is the
node, any other column feeds eager relationship hydration
(neode's Factory.hydrate)
*/
export function hydrate<T>(
  constructor: new (...arguments_: never[]) => T,
  output: QueryOutput,
  alias = DEFAULT_ALIAS,
): WithMethods<T>[] {
  const schema = requireSchema(constructor)

  return output.records
    .filter((row) => row.has(alias) && isGraphNode(row.get(alias)))
    .map((row) => {
      const node: unknown = row.get(alias)

      if (!isGraphNode(node)) {
        throw new TypeError(`The "${alias}" column did not return a node value`)
      }

      return hydrateNode<T>(schema, constructor, node, eagerColumns(row, alias))
    })
}

/**
JSON-safe the rows (the pass `Neode#cypher` gives its records) and hydrate
them into entities when the caller requested a class; the raw output
passes through untouched otherwise (NTS-559, the read()/write() hydrate
overloads)
*/
export function hydrateWhenRequested<T>(
  options: { hydrate?: new (...arguments_: never[]) => T; alias?: string },
  output: QueryOutput,
): QueryOutput | WithMethods<T>[] {
  if (options.hydrate === undefined) {
    return output
  }

  const rows: QueryOutput = {
    records: output.records.map((record) => jsonSafeRecord(record)),
    summary: output.summary,
  }

  return hydrate(options.hydrate, rows, options.alias)
}

type HydrateCallOptions = HydrateQueryOptions & {
  hydrate?: new (...arguments_: never[]) => unknown
}

/**
True when the second read()/write() argument carries the hydrate options
object (NTS-559, the two-argument form) rather than positional
parameters — an options object is recognised by a function-valued
`hydrate` key, a class constructor, which can never be a legal Cypher
parameter
*/
function isHydrateOptions(
  value: QueryParameters | HydrateQueryOptions,
): value is HydrateQueryOptions {
  return 'hydrate' in value && typeof value['hydrate'] === 'function'
}

function isQueryParameters(value: QueryParameters | HydrateQueryOptions): value is QueryParameters {
  return !isHydrateOptions(value)
}

/**
Normalise the read()/write() argument shapes (facade and transaction
scope): the third argument is the positional database (NTS-553) or the
hydrate options object (NTS-559), and the NTS-559 two-argument form puts
the options object in the second-argument position.
*/
export function splitHydrateArguments(
  parametersOrOptions: QueryParameters | HydrateQueryOptions,
  databaseOrOptions: string | HydrateCallOptions,
): { parameters: QueryParameters; options: HydrateCallOptions; database: string | undefined } {
  let options: HydrateCallOptions

  if (typeof databaseOrOptions === 'string') {
    options = {}
  } else if (databaseOrOptions.hydrate === undefined && isHydrateOptions(parametersOrOptions)) {
    options = parametersOrOptions
  } else {
    options = databaseOrOptions
  }

  return {
    parameters: isQueryParameters(parametersOrOptions) ? parametersOrOptions : {},
    options,
    database: typeof databaseOrOptions === 'string' ? databaseOrOptions : options.database,
  }
}

/**
Hydrate the first record of a raw query result, or undefined when the
result set is empty (neode's Factory.hydrateFirst)
*/
export function hydrateFirst<T>(
  constructor: new (...arguments_: never[]) => T,
  output: QueryOutput,
  alias = DEFAULT_ALIAS,
): WithMethods<T> | undefined {
  return hydrate<T>(constructor, output, alias)[0]
}

/**
Hydrate a raw query result into a Collection (neode's Factory.hydrate
return shape)
*/
export function toCollection<T>(
  constructor: new (...arguments_: never[]) => T,
  output: QueryOutput,
  alias = DEFAULT_ALIAS,
): Collection<T> {
  return new Collection(hydrate<T>(constructor, output, alias))
}
