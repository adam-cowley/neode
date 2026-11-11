import type { Builder } from '../../query/index.js'
import { THIS_NODE } from '../../constants.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { NeodeError, suggestionFor } from '../../errors/index.js'
import { propertyReference } from '../../query/quote.js'
import { Where, WhereNull } from '../../query/index.js'

/**
The read-filter bag helpers (NTS-646): the shared consumption path for the
model-filtered `where` bags the facade, the transactional mirrors and the
Repository accept on the plain reads — property equality (byte-identical to
the per-service loops it replaced) plus the operator-object tier rendered
through the Builder's operator methods. The projection path keeps its own
traversal loop (aliases, EXISTS) and renders its operator tier through
`applyFilterOperators`; the hand-written keyset statement renders the same
operators through `renderFilterOperatorConditions`.
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
`applyFilterOperator` (the Builder tier) and `renderFilterOperatorConditions`
(hand-written statements); anything else fails loud.

shortcut: the two dispatches spell their operators independently (Builder
method calls vs Where / WhereNull clause classes) — adding an operator
means touching both switches, until a third consumer justifies lifting the
dispatch into the Builder.
*/
const FILTER_OPERATOR_KEYS = 'eq|neq|gt|gte|lt|lte|in|contains|startsWith|endsWith|null'

/**
The shared rejection for an operator key outside the set — one message
shape for both rendering tiers.
*/
function unknownFilterOperator(key: string, operator: string): NeodeError {
  return new NeodeError(
    `Unknown where-filter operator "${operator}" on property "${key}" — the supported operators are ${FILTER_OPERATOR_KEYS}. Fix the operator name, or pass the bare value for equality`,
  )
}

/**
The operator entries of an operator-object filter value. An object with no
operator keys is a caller bug — rendering it would silently filter nothing,
the exact failure this tier exists to prevent.
*/
function operatorEntries(key: string, operators: Record<string, unknown>): [string, unknown][] {
  const entries = Object.entries(operators)

  if (entries.length === 0) {
    throw new NeodeError(
      `The filter on property "${key}" is an empty operator object — pass the bare value for equality, or one of the operators: ${FILTER_OPERATOR_KEYS}`,
    )
  }

  return entries
}

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
      throw unknownFilterOperator(key, operator)
    }
  }
}

/**
Render one filter-operator object onto the builder, in key order. An
operator object with no operator keys throws (it would silently filter
nothing).
*/
export function applyFilterOperators(
  builder: Builder,
  alias: string,
  key: string,
  operators: Record<string, unknown>,
): void {
  for (const [operator, value] of operatorEntries(key, operators)) {
    applyFilterOperator(builder, alias, key, operator, value)
  }
}

/**
Render ONE filter operator as a standalone WHERE condition for the
hand-written statements the Builder cannot assemble (the keyset page wraps
a parameter in a temporal cast, so its statement is written by hand). The
same clause classes the Builder's operator methods append — `Where` /
`WhereNull` — carry the operator spellings, the value binds as a parameter
under `filter_<property>_<operator>`, uniquified against the statement's
parameters.

shortcut: the operator dispatch mirrors the Builder methods in
`applyFilterOperator` — see the note on FILTER_OPERATOR_KEYS.
*/
function renderFilterOperatorCondition(
  reference: string,
  key: string,
  operator: string,
  value: unknown,
  parameters: Record<string, unknown>,
): string {
  const sanitised = `filter_${key}_${operator}`.replaceAll(/[^a-z0-9]+/gi, '_')

  let parameter = sanitised
  let attempt = 1

  while (Object.hasOwn(parameters, parameter)) {
    attempt++

    parameter = `${sanitised}_${String(attempt)}`
  }

  switch (operator) {
    case 'eq': {
      parameters[parameter] = value

      return new Where(reference, '=', `$${parameter}`).toString()
    }
    case 'neq': {
      parameters[parameter] = value

      const clause = new Where(reference, '=', `$${parameter}`)

      clause.setNegative()

      return clause.toString()
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      parameters[parameter] = value

      const spelled: Record<'gt' | 'gte' | 'lt' | 'lte', string> = {
        gt: '>',
        gte: '>=',
        lt: '<',
        lte: '<=',
      }

      return new Where(reference, spelled[operator], `$${parameter}`).toString()
    }
    case 'in': {
      parameters[parameter] = requireArray(key, value)

      return new Where(reference, 'IN', `$${parameter}`).toString()
    }
    case 'contains':
    case 'startsWith':
    case 'endsWith': {
      parameters[parameter] = requireString(key, operator, value)

      const spelled: Record<'contains' | 'startsWith' | 'endsWith', string> = {
        contains: 'CONTAINS',
        startsWith: 'STARTS WITH',
        endsWith: 'ENDS WITH',
      }

      return new Where(reference, spelled[operator], `$${parameter}`).toString()
    }
    case 'null': {
      const clause = new WhereNull(reference)

      if (value !== true) {
        clause.setNegative()
      }

      return clause.toString()
    }
    default: {
      throw unknownFilterOperator(key, operator)
    }
  }
}

/**
Render one filter-operator object as standalone WHERE conditions, in key
order. An operator object with no operator keys throws (it would silently
filter nothing).
*/
export function renderFilterOperatorConditions(
  alias: string,
  key: string,
  operators: Record<string, unknown>,
  parameters: Record<string, unknown>,
): string[] {
  const reference = propertyReference(alias, key)
  const conditions: string[] = []

  for (const [operator, value] of operatorEntries(key, operators)) {
    conditions.push(renderFilterOperatorCondition(reference, key, operator, value, parameters))
  }

  return conditions
}

/**
Every bag key must be a declared property of the model the bag filters:
unknown keys and relationship keys are refused fail-loud instead of being
silently ignored — a silently-ignored filter narrows nothing, which on the
reads is wrong rows and on deleteAll() is a wipe.
*/
export function assertFilterKeys(schema: EntitySchema, parameters: Record<string, unknown>): void {
  const declared = schema.getProperties().map((property) => property.getKey())

  for (const key of Object.keys(parameters)) {
    if (declared.includes(key)) {
      continue
    }

    if (schema.hasRelationship(key)) {
      throw new NeodeError(
        `The where-filter key "${key}" is a relationship of ${schema.getLabels().join(':') || 'entity'} — nested filter bags only run on the projection path (reads of models with projected properties or an explicit with spec), and this path would silently ignore the filter. Filter on a declared property, or use a projection read`,
      )
    }

    const suggestion = suggestionFor(key, declared)

    throw new NeodeError(
      `Unknown where-filter key "${key}" on ${schema.getLabels().join(':') || 'entity'}` +
        (suggestion === undefined ? '' : ` — did you mean "${suggestion}"?`) +
        ` — filters take the model's declared property names (${declared.join(', ') || 'none declared'}). Check the key, or drop it`,
    )
  }
}

/**
Apply one where filter bag to the builder: declared property keys filter
as property equality (the historical loop, byte-identical Cypher) or —
when the value is a plain map — through the operator tier. Every bag key
is checked against the schema first (assertFilterKeys): unknown keys and
relationship keys throw instead of being silently dropped.
*/
export function applyFilterBag(
  builder: Builder,
  schema: EntitySchema,
  parameters: Record<string, unknown>,
  alias: string = THIS_NODE,
): void {
  assertFilterKeys(schema, parameters)

  for (const property of schema.getProperties()) {
    const key = property.getKey()

    if (!Object.hasOwn(parameters, key)) {
      continue
    }

    const value = parameters[key]

    if (!isFilterMap(value)) {
      builder.where(propertyReference(alias, key), value)

      continue
    }

    applyFilterOperators(builder, alias, key, value)
  }
}
