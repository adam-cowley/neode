import type { QueryOutput, QueryRecord } from './driver/types.js'
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
