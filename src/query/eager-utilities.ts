import { Builder } from './builder.js'
import { getModel } from '../meta/index.js'
import type { EntitySchema } from '../meta/entity/entity-schema.js'
import { EntityType } from '../meta/entity/entity-schema.js'
import type { RelationshipPropertySchema } from '../meta/relationship-property-schema.js'

export const EAGER_ID = '__EAGER_ID__'
export const EAGER_LABELS = '__EAGER_LABELS__'
export const EAGER_TYPE = '__EAGER_TYPE__'
export const MAX_EAGER_DEPTH = 3

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
): string {
  const builder = new Builder()

  const name = relationship.getKey()
  const type = relationship.getType()
  const direction = relationship.getDirection()
  const relationshipVariable = `${alias}_${name}_rel`
  const nodeVariable = `${alias}_${name}_node`

  const targetSchema = getModel(relationship.getTarget()) as EntitySchema | undefined

  // Build Pattern
  builder
    .match(alias)
    .relationship(type, direction, relationshipVariable)
    .to(nodeVariable, targetSchema?.getLabels() ?? false)

  const fields =
    targetSchema?.getType() === EntityType.RelationshipEntity
      ? eagerRelationship(depth + 1, relationshipVariable, name, nodeVariable, targetSchema)
      : eagerNode(depth + 1, nodeVariable, targetSchema)

  const pattern = `${name}: [ ${builder.pattern().trim()} | ${fields} ]`

  // Get the first?
  return relationship.getMany() ? pattern : pattern + '[0]'
}

/**
Produces a Cypher map projection for a consistent eager loading format for
a Node and any subsequent eagerly loaded models up to the maximum depth.

neode projected `__EAGER_ID__` with the deprecated `id()`; elementId() is
the modern equivalent (it returns a string rather than a number).
*/
export function eagerNode(depth: number, alias: string, schema?: EntitySchema): string {
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
      pattern += `\n${indent}${indent},` + eagerPattern(depth, alias, relationship)
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
  pattern += eagerNode(depth + 1, nodeVariable, nodeModel)

  pattern += `\n${indent}}`

  return pattern
}
