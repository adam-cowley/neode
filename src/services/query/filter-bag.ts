import type { Builder } from '../../query/index.js'
import { THIS_NODE } from '../../constants.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { NeodeError } from '../../errors/index.js'
import { propertyReference } from '../../query/quote.js'

/**
The read-filter bag helpers (NTS-646): the ONE consumption path for the
model-filtered `where` bags the facade, the transactional mirrors and the
Repository accept — property equality (byte-identical to the per-service
loops it replaced) plus the operator-object tier rendered through the
Builder's operator methods.
*/

/**
A nested filter value: a plain map. Plain-object rule — `Date`, driver
temporals and `Point` instances stay equality values; arrays too.
*/
export function isFilterMap(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype: unknown = Object.getPrototypeOf(value)

  // Plain maps only — Date, driver temporals etc. stay own-property values
  return prototype === Object.prototype || prototype === null
}

/**
The supported operator keys of a filter-operator object (NTS-646) — the
Builder methods that take (property, value). Rendered through
`applyFilterOperator`; anything else fails loud.
*/
const FILTER_OPERATOR_KEYS = 'eq|neq|gt|gte|lt|lte|in|contains|startsWith|endsWith|null'

/**
The string-operator tier requires a string value (the Builder binds it as
a parameter); a non-string is a caller bug — fail loud instead of binding
junk (or an always-true empty string).
*/
function requireString(key: string, operator: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new NeodeError(
      `The "${operator}" filter on property "${key}" expects a string value, received ${typeof value} — pass a string, or use the typed WhereFilter bag`,
    )
  }

  return value
}

/**
The membership tier requires an array of values.
*/
function requireArray(key: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new NeodeError(
      `The "in" filter on property "${key}" expects an array of values, received ${typeof value} — pass an array, or use the typed WhereFilter bag`,
    )
  }

  return value
}

/**
Render ONE filter operator through its Builder method, the value bound as
a parameter. Unknown operator keys throw (fail loud — the same rule as the
projection path's nested-filter rejection), so a mistyped operator never
silently filters nothing.
*/
function applyFilterOperator(
  builder: Builder,
  alias: string,
  key: string,
  operator: string,
  value: unknown,
): void {
  const reference = propertyReference(alias, key)

  switch (operator) {
    case 'eq': {
      builder.where(reference, value)
      break
    }
    case 'neq': {
      builder.whereNot(reference, value)
      break
    }
    case 'gt': {
      builder.where(reference, '>', value)
      break
    }
    case 'gte': {
      builder.where(reference, '>=', value)
      break
    }
    case 'lt': {
      builder.where(reference, '<', value)
      break
    }
    case 'lte': {
      builder.where(reference, '<=', value)
      break
    }
    case 'in': {
      builder.whereIn(reference, requireArray(key, value))
      break
    }
    case 'contains': {
      builder.whereContains(reference, requireString(key, operator, value))
      break
    }
    case 'startsWith': {
      builder.whereStartsWith(reference, requireString(key, operator, value))
      break
    }
    case 'endsWith': {
      builder.whereEndsWith(reference, requireString(key, operator, value))
      break
    }
    case 'null': {
      if (value === true) {
        builder.whereNull(reference)
      } else {
        builder.whereNotNull(reference)
      }
      break
    }
    default: {
      throw new NeodeError(
        `Unknown where-filter operator "${operator}" on property "${key}" — the supported operators are ${FILTER_OPERATOR_KEYS}. Fix the operator name, or pass the bare value for equality`,
      )
    }
  }
}

/**
Render one filter-operator object onto the builder, in key order.
*/
export function applyFilterOperators(
  builder: Builder,
  alias: string,
  key: string,
  operators: Record<string, unknown>,
): void {
  for (const [operator, value] of Object.entries(operators)) {
    applyFilterOperator(builder, alias, key, operator, value)
  }
}

/**
Apply one where filter bag to the builder: declared property keys filter
as property equality (the historical loop, byte-identical Cypher) or —
when the value is a plain map — through the operator tier. Unknown keys
are ignored (the consumption loop iterates the schema's DECLARED
properties; the typed `WhereFilter<C>` bag rejects them at compile time).
*/
export function applyFilterBag(
  builder: Builder,
  schema: EntitySchema,
  parameters: Record<string, unknown>,
): void {
  for (const property of schema.getProperties()) {
    const key = property.getKey()

    if (!Object.hasOwn(parameters, key)) {
      continue
    }

    const value = parameters[key]

    if (!isFilterMap(value)) {
      builder.where(`${THIS_NODE}.${key}`, value)

      continue
    }

    applyFilterOperators(builder, THIS_NODE, key, value)
  }
}
