import { Builder } from './builder.js'
import { getModel } from '../meta/index.js'
import type { EntitySchema } from '../meta/entity/entity-schema.js'
import { EntityType } from '../meta/entity/entity-schema.js'
import type { RelationshipPropertySchema } from '../meta/relationship-property-schema.js'
import { applyOrder, type OrderSpec } from './order-spec.js'
import { applyReadFilters, type ReadFilterOptions } from '../services/query/filters.js'

/**
The filter context an eager pattern needs (NTS-162): the executing builder
the comprehension's filter parameters bind onto, and the owning read's
filter options.
*/
export interface EagerFilterContext {
  builder: Builder
  filters?: ReadFilterOptions | undefined
}

export const EAGER_ID = '__EAGER_ID__'
export const EAGER_LABELS = '__EAGER_LABELS__'
export const EAGER_TYPE = '__EAGER_TYPE__'
export const MAX_EAGER_DEPTH = 3

/**
The variable an eager pattern binds the related node to — exported because
the lazy relation loader (NTS-558) matches the target node under the same
name before hydrating it.
*/
export function eagerNodeVariable(alias: string, name: string): string {
  return `${alias}_${name}_node`
}

/**
Build a pattern to use in an eager load statement:
`<name>: [ <pattern> | <fields> ]`, with a `[0]` suffix on singular
relationships.

neode resolved the target model via `neode.model(rel.target())` inside a
try/catch; here the target schema comes straight from the relationship's
metamodel entry, and an unregistered target simply yields no nested eager
fields.
*/
export function eagerPattern(
  depth: number,
  alias: string,
  relationship: RelationshipPropertySchema,
  context?: EagerFilterContext,
): string {
  const builder = new Builder()

  const name = relationship.getKey()
  const type = relationship.getType()
  const direction = relationship.getDirection()
  const relationshipVariable = `${alias}_${name}_rel`
  const nodeVariable = eagerNodeVariable(alias, name)

  const targetSchema = getModel(relationship.getTarget()) as EntitySchema | undefined

  // Build Pattern
  builder
    .match(alias)
    .relationship(type, direction, relationshipVariable)
    .to(nodeVariable, targetSchema?.getLabels() ?? false)

  // NTS-162 — the target model's named read filters render as a WHERE
  // inside the pattern comprehension: a filtered-out target simply doesn't
  // match, the comprehension yields [] and the parent row survives (never
  // OPTIONAL MATCH). The comprehension is part of the outer statement, so
  // its filter parameters bind onto the executing builder.
  if (targetSchema !== undefined) {
    applyReadFilters(builder, targetSchema, context?.filters, nodeVariable)

    if (context?.builder !== undefined) {
      const { params } = builder.build()

      for (const [parameter, value] of Object.entries(params)) {
        context.builder.param(parameter, value)
      }
    }
  }

  const fields =
    targetSchema?.getType() === EntityType.RelationshipEntity
      ? eagerRelationship(
          depth + 1,
          relationshipVariable,
          name,
          nodeVariable,
          targetSchema,
          context,
        )
      : eagerNode(depth + 1, nodeVariable, targetSchema, context)

  const pattern = `${name}: [ ${builder.pattern().trim()} | ${fields} ]`

  // Get the first?
  return relationship.getMany() ? pattern : pattern + '[0]'
}

/**
One validated level of a per-instance load spec (NTS-498): the level's
traversal trim (order / skip / limit) and its own disabled filter names,
plus the nested keys parsed one level down the declared relationship graph
(by parseLoadLevel in the load-relation service).
*/
export interface ParsedLoadLevel {
  order?: OrderSpec | undefined
  skip?: number | undefined
  limit?: number | undefined
  /**
  This level's OWN disabled filter names — the ancestors' arrive through
  the context and stack on top at render time
  */
  withoutFilters?: string[] | undefined
  nested: Map<string, ParsedLoadLevel>
}

/**
One requested key of a per-instance load spec (NTS-498), rendered into the
parent node's projection map. A level with no order/skip/limit renders a
pattern comprehension; a trimmed level renders a per-row `COLLECT { MATCH
… RETURN … ORDER BY … }` subquery (NTS-565 — a comprehension cannot carry
ORDER BY / LIMIT, and no OPTIONAL MATCH is ever emitted). The target's
named read filters (NTS-162) render inside either form: a filtered-out
target yields [] and the parent row survives.
*/
function specLevelPattern(
  depth: number,
  alias: string,
  relationship: RelationshipPropertySchema,
  level: ParsedLoadLevel,
  context?: EagerFilterContext,
): string {
  const key = relationship.getKey()
  const targetSchema = getModel(relationship.getTarget()) as EntitySchema | undefined
  const nodeVariable = eagerNodeVariable(alias, key)
  const relationshipVariable = `${alias}_${key}_rel`

  // The level's own disabled filters stack on the context's, and the
  // merged set is what every level below sees
  const withoutFilters = [
    ...(context?.filters?.withoutFilters ?? []),
    ...(level.withoutFilters ?? []),
  ]

  const filters: ReadFilterOptions | undefined =
    withoutFilters.length > 0 ? { withoutFilters } : context?.filters

  const childContext: EagerFilterContext | undefined =
    context === undefined ? undefined : { builder: context.builder, filters }

  const labels = targetSchema?.getLabels() ?? false
  const fields = eagerNode(depth + 1, nodeVariable, targetSchema, childContext, level)

  const isTrimmed =
    level.order !== undefined || level.skip !== undefined || level.limit !== undefined

  if (!isTrimmed) {
    const builder = new Builder()

    builder
      .match(alias)
      .relationship(relationship.getType(), relationship.getDirection(), relationshipVariable)
      .to(nodeVariable, labels)

    // NTS-162 — the target's named filters filter the comprehension's
    // rows; the comprehension is part of the outer statement, so its
    // filter parameters bind onto the executing builder
    if (targetSchema !== undefined) {
      applyReadFilters(builder, targetSchema, filters, nodeVariable)

      if (context?.builder !== undefined) {
        const { params } = builder.build()

        for (const [parameter, value] of Object.entries(params)) {
          context.builder.param(parameter, value)
        }
      }
    }

    const pattern = `${key}: [ ${builder.pattern().trim()} | ${fields} ]`

    return relationship.getMany() ? pattern : `${pattern}[0]`
  }

  // The trim cannot ride a comprehension — the COLLECT subquery imports
  // the parent node and shapes its rows before collecting (compileSub
  // namespaces the filter parameters)
  const collected = (context?.builder ?? new Builder()).collectExpr(
    (sub) => {
      sub
        .match(alias)
        .relationship(relationship.getType(), relationship.getDirection(), relationshipVariable)
        .to(nodeVariable, labels)

      if (targetSchema !== undefined) {
        applyReadFilters(sub, targetSchema, filters, nodeVariable)
      }

      sub.return(fields)
      applyOrder(sub, level.order, nodeVariable)

      if (level.skip !== undefined) {
        sub.skip(level.skip)
      }

      if (level.limit !== undefined) {
        sub.limit(level.limit)
      }

      return sub
    },
    [alias],
  )

  return `${key}: ${collected}`
}

/**
Produces a Cypher map projection for a consistent eager loading format for
a Node and any subsequent eagerly loaded models up to the maximum depth.

neode projected `__EAGER_ID__` with the deprecated `id()`; elementId() is
the modern equivalent (it returns a string rather than a number).

`spec` (NTS-498) additionally renders the requested keys of a per-instance
load — one nested specLevelPattern per key, after the static-eager ones.
*/
export function eagerNode(
  depth: number,
  alias: string,
  schema?: EntitySchema,
  context?: EagerFilterContext,
  spec?: ParsedLoadLevel,
): string {
  const indent = `  `.repeat(depth * 2)
  let pattern = `\n${indent} ${alias} { `

  // Properties
  pattern += `\n${indent}${indent}.*`

  // ID
  pattern += `\n${indent}${indent},${EAGER_ID}: elementId(${alias})`

  // Labels
  pattern += `\n${indent}${indent},${EAGER_LABELS}: labels(${alias})`

  // Eager
  if (schema && depth <= MAX_EAGER_DEPTH) {
    const eagerRelationships = schema
      .getRelationships()
      .filter((relationship) => relationship.getEager())

    for (const relationship of eagerRelationships) {
      pattern += `\n${indent}${indent},` + eagerPattern(depth, alias, relationship, context)
    }
  }

  // NTS-498 — the per-instance load spec's requested keys render after
  // the static-eager ones, with no depth cap: the caller's spec object
  // bounds the recursion (parseLoadLevel validated every key against
  // this schema before the statement was composed)
  if (schema && spec !== undefined && spec.nested.size > 0) {
    for (const [key, level] of spec.nested) {
      pattern +=
        `\n${indent}${indent},` +
        specLevelPattern(depth, alias, schema.getRelationship(key), level, context)
    }
  }

  pattern += `\n${indent}}`

  return pattern
}

/**
Produces a Cypher map projection for a consistent eager loading format for
a Relationship and the node it connects to, up to the maximum depth.
*/
export function eagerRelationship(
  depth: number,
  alias: string,
  nodeAlias: string,
  nodeVariable: string,
  nodeModel?: EntitySchema,
  context?: EagerFilterContext,
): string {
  const indent = `  `.repeat(depth * 2)
  let pattern = `\n${indent} ${alias} { `

  // Properties
  pattern += `\n${indent}${indent}.*`

  // ID
  pattern += `\n${indent}${indent},${EAGER_ID}: elementId(${alias})`

  // Type
  pattern += `\n${indent}${indent},${EAGER_TYPE}: type(${alias})`

  // Node Alias
  pattern += `\n${indent}${indent},${nodeAlias}: `
  pattern += eagerNode(depth + 1, nodeVariable, nodeModel, context)

  pattern += `\n${indent}}`

  return pattern
}
