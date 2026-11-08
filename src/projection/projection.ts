import { EAGER_ID, EAGER_LABELS, eagerPattern } from '../query/eager-utilities.js'
import { Direction } from '../query/index.js'
import { EntitySchema } from '../meta/entity/entity-schema.js'
import { NeodeError } from '../errors/index.js'
import { quote } from '../query/quote.js'
import type { Newable } from '../meta/newable.js'
import type { PropertySchema } from '../meta/property-schema.js'
import { PropertyType, isProjectedProperty } from '../meta/property-schema.js'
import { RelationshipPropertySchema } from '../meta/relationship-property-schema.js'
import { getModel } from '../meta/index.js'

/**
Read-model projection composition (NTS-135/136/137/138).

Every projected property kind composes into the RETURN map projection of
the one read query — pattern comprehensions for related subsets, inline
`COUNT { }` / `EXISTS { }` subqueries, label predicates and raw
expressions — instead of chasing each relationship with its own query.
*/

/**
Target node labels as a Cypher label pattern (':A:B'), or ''
*/
function targetLabels(property: PropertySchema): string {
  return labelsPattern(property.getEntity())
}

/**
Label pattern for a hop's end model (':A:B'), or '' — unregistered or
absent targets render type-less
*/
function labelsPattern(entity: Newable | undefined): string {
  // Fields-subset properties carry no target entity (it is not needed for
  // their projection) — no label pattern to append
  if (entity === undefined) {
    return ''
  }

  const targetSchema = getModel(entity)

  if (!(targetSchema instanceof EntitySchema)) {
    return ''
  }

  const labels = targetSchema.getLabels()

  return labels.length > 0 ? ':' + labels.map((label) => quote(label)).join(':') : ''
}

/**
Variable-length hop pattern ('', '*2', '*1..2', '*..3', '*1..')
*/
function hopPattern(property: PropertySchema): string {
  const minHops = property.getMinHops()
  const maxHops = property.getMaxHops()

  if (minHops === undefined && maxHops === undefined) {
    return ''
  }

  if (minHops !== undefined && minHops === maxHops) {
    return `*${String(minHops)}`
  }

  if (minHops !== undefined && maxHops !== undefined) {
    return `*${String(minHops)}..${String(maxHops)}`
  }

  if (minHops !== undefined) {
    return `*${String(minHops)}..`
  }

  return `*..${String(maxHops)}`
}

/**
Relationship pattern with the target node bound to `node` — the variable
convention for `where` fragments (and what the subqueries count / test).
*/
function relationshipPattern(alias: string, property: PropertySchema): string {
  // NTS-547 — multi-hop path: chain the hops from the root alias, the last
  // hop binding the `node` variable (same convention as the single hop)
  const path = property.getPath()

  if (path !== undefined && path.length > 0) {
    const segments: string[] = [`(${alias})`]

    path.forEach((hop, index) => {
      const last = index === path.length - 1
      const to = last ? 'node' : `${alias}_h${String(index + 1)}`
      const arrowIn = hop.direction === Direction.INCOMING ? '<' : ''
      const arrowOut = hop.direction === Direction.OUTGOING ? '>' : ''
      const type = hop.type.length > 0 ? `[:${quote(hop.type)}]` : '[]'
      const labels = last ? targetLabels(property) : labelsPattern(hop.target?.())

      segments.push(`${arrowIn}-${type}-${arrowOut}(${to}${labels})`)
    })

    return segments.join('')
  }

  const direction = property.getDirection() ?? Direction.OUTGOING

  const type = (property.getRelationshipType() ?? '')
    .split('|')
    .filter((part) => part.length > 0)
    .map((part) => quote(part))
    .join('|')

  const types = type.length > 0 ? `:${type}` : ''

  const directionIn = direction === Direction.INCOMING ? '<' : ''
  const directionOut = direction === Direction.OUTGOING ? '>' : ''

  return `(${alias})${directionIn}-[${types}${hopPattern(property)}]-${directionOut}(node${targetLabels(property)})`
}

/**
WHERE fragment inside COUNT { } / EXISTS { } subqueries
*/
function subqueryWhere(property: PropertySchema): string {
  const where = property.getWhere()

  return where !== undefined && where.length > 0 ? ` WHERE ${where}` : ''
}

/**
Pattern comprehension for a @RelatedOne / @RelatedMany property
*/
function relatedProjection(alias: string, property: PropertySchema): string {
  const key = property.getKey()
  const fields = property.getFields()

  // No field subset: full-entity eager loading (the existing eager patterns)
  if (fields === undefined || fields.length === 0) {
    const relationship = new RelationshipPropertySchema(key)

    relationship.setType(property.getRelationshipType() ?? key)
    relationship.setDirection(property.getDirection() ?? Direction.OUTGOING)
    const target = property.getEntity()

    if (target === undefined) {
      throw new Error(
        `Projection property "${key}" has no field subset and no target — add 'fields' or 'target()'`,
      )
    }

    relationship.setTarget(target)
    relationship.setMany(property.getType() === PropertyType.RELATED_MANY)

    return eagerPattern(1, alias, relationship)
  }

  const isMany = property.getType() === PropertyType.RELATED_MANY

  const pattern =
    fields.length === 1
      ? `node.${fields[0] ?? ''}`
      : `node { ${fields.map((field) => `.${field}`).join(', ')} }`

  const comprehension = `[ ${relationshipPattern(alias, property)} | ${pattern} ]`

  // First related node only for the singular form
  return isMany ? `${key}: ${comprehension}` : `${key}: ${comprehension}[0]`
}

/**
One `key: expression` pair of the RETURN map projection
*/
function projectedProperty(alias: string, property: PropertySchema): string {
  const type = property.getType()
  const key = property.getKey()

  if (type === PropertyType.RELATED_ONE || type === PropertyType.RELATED_MANY) {
    return relatedProjection(alias, property)
  }

  if (type === PropertyType.RELATIONSHIP_COUNT) {
    return `${key}: COUNT { ${relationshipPattern(alias, property)}${subqueryWhere(property)} }`
  }

  if (type === PropertyType.RELATIONSHIP_EXISTS) {
    return `${key}: EXISTS { ${relationshipPattern(alias, property)}${subqueryWhere(property)} }`
  }

  if (type === PropertyType.LABEL_PRESENT) {
    const label = property.getLabel()

    if (label === undefined) {
      throw new NeodeError(`@LabelPresent property "${key}" requires a label`)
    }

    return `${key}: ${alias}:${quote(label)}`
  }

  // COMPUTED runs in TypeScript after hydration
  return type === PropertyType.EXPRESSION ? `${key}: ${property.getExpression() ?? ''}` : ''
}

/**
True when any property of the model projects a read-model value
*/
export function hasProjectedProperties(schema: EntitySchema): boolean {
  return schema.getProperties().some((property) => isProjectedProperty(property))
}

/**
The RETURN map projection for a model's read query: all properties, the
hydration identity markers, full-entity eager relationships and every
projected property — one query per read.
*/
export function projectionNode(alias: string, schema: EntitySchema): string {
  const parts: string[] = [
    '.*',
    `${EAGER_ID}: elementId(${alias})`,
    `${EAGER_LABELS}: labels(${alias})`,
  ]

  // Full-entity eager relationships (existing eager machinery)
  for (const relationship of schema.getRelationships()) {
    if (relationship.getEager()) {
      parts.push(eagerPattern(1, alias, relationship))
    }
  }

  // Projected read-model properties
  for (const property of schema.getProperties()) {
    if (isProjectedProperty(property) && property.getType() !== PropertyType.COMPUTED) {
      parts.push(projectedProperty(alias, property))
    }
  }

  return `${alias} { ${parts.join(', ')} }`
}
