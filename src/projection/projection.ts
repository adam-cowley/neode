import { EAGER_ID, EAGER_LABELS, eagerPattern } from '../query/eager-utilities.js'
import { type Builder, Direction } from '../query/index.js'
import { EntityType, EntitySchema } from '../meta/entity/entity-schema.js'
import { NeodeError } from '../errors/index.js'
import { quote } from '../query/quote.js'
import type { LoadSpec, RelationQuery } from '../query/load-spec.js'
import type { Newable } from '../meta/newable.js'
import type { PropertySchema } from '../meta/property-schema.js'
import { PropertyType, isProjectedProperty } from '../meta/property-schema.js'
import { RelationshipPropertySchema } from '../meta/relationship-property-schema.js'
import { getModel } from '../meta/index.js'
import { isRecord } from '../services/type-guards.js'

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

    for (const [index, hop] of path.entries()) {
      const isLast = index === path.length - 1
      const to = isLast ? 'node' : `${alias}_h${String(index + 1)}`
      const arrowIn = hop.direction === Direction.INCOMING ? '<' : ''
      const arrowOut = hop.direction === Direction.OUTGOING ? '>' : ''
      const type = hop.type.length > 0 ? `[:${quote(hop.type)}]` : '[]'
      const labels = isLast ? targetLabels(property) : labelsPattern(hop.target?.())

      segments.push(`${arrowIn}-${type}-${arrowOut}(${to}${labels})`)
    }

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

  // NTS-547 — WHERE inside the comprehension filters elements per path
  // (`node` = the target node, `this` = the annotated node)
  const where = property.getWhere()
  const filter = where !== undefined && where.length > 0 ? ` WHERE ${where}` : ''

  const comprehension = `[ ${relationshipPattern(alias, property)}${filter} | ${pattern} ]`

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
True for a load spec entry: a plain request (`true`) or a callback
decorating the relation's read
*/
function isLoadSpec(value: unknown): value is true | LoadSpec {
  return value === true || typeof value === 'function'
}

/**
One requested entry of the with-spec: undefined when the key was not
requested, `true` for a plain request, the callback for a decorated one.
A non-`true` non-callback value counts as not requested (`false`).
*/
function requestedSpec(withSpec: object | undefined, key: string): true | LoadSpec | undefined {
  if (withSpec === undefined || !Object.hasOwn(withSpec, key)) {
    return undefined
  }

  const value: unknown = Reflect.get(withSpec, key)

  if (value === undefined || value === false) {
    return undefined
  }

  if (isLoadSpec(value)) {
    return value
  }

  throw new NeodeError(
    `The load spec ("with") entry for "${key}" must be true or a (relation) => void callback`,
  )
}

/**
Validate the with-spec up front: every requested key must name a declared
relationship (a NeodeError naming the model and key otherwise)
*/
function validateWithSpec(schema: EntitySchema, withSpec: object | undefined): void {
  if (withSpec === undefined) {
    return
  }

  for (const key of Object.keys(withSpec)) {
    if (!schema.hasRelationship(key)) {
      throw new NeodeError(
        `Unknown relationship "${key}" on ${schema.getLabels().join(':') || 'entity'}` +
          ` — it cannot be requested in the load spec ("with")`,
      )
    }
  }
}

/**
The RETURN-alias a decorated load spec's CALL subquery publishes
(`this_orders_loaded`), mirrored by the projection fragment that reads it
*/
function loadSpecAlias(alias: string, key: string): string {
  return `${alias}_${key}_loaded`
}

/**
One recorded operation of a load spec callback: the view records, the
loader replays each kind into the clause it belongs to
*/
interface RecordedRelationOperation {
  kind: 'where' | 'order' | 'limit' | 'skip'
  arguments_: unknown[]
}

/**
Bare property names on the relation's sub-builder resolve against the
related node's variable; anything else (dotted, raw fragments) passes
through untouched
*/
function relationProperty(nodeVariable: string, property: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(property) ? `${nodeVariable}.${property}` : property
}

/**
Prefix the property of an orderBy argument list: the first argument (a
property name or a { field } descriptor) carries the property, the rest
are directions
*/
function relationOrderArguments(nodeVariable: string, arguments_: unknown[]): unknown[] {
  const [first, ...rest] = arguments_

  if (isRecord(first) && typeof first['field'] === 'string') {
    return [{ ...first, field: relationProperty(nodeVariable, first['field']) }, ...rest]
  }

  if (typeof first === 'string') {
    return [relationProperty(nodeVariable, first), ...rest]
  }

  return arguments_
}

/**
The restricted relation view a load spec callback decorates: only
where / orderBy / limit / skip exist on it, and every operation is
RECORDED — the loader replays wheres into the MATCH's WHERE and the
sort/page operations into the WITH clause that trims the related rows,
whatever order the callback called them in. Bare property names resolve
against the related node at replay time.
*/
function relationQuery(): { view: RelationQuery; operations: RecordedRelationOperation[] } {
  const operations: RecordedRelationOperation[] = []

  const view: RelationQuery = {
    where: (...arguments_: unknown[]) => {
      operations.push({ kind: 'where', arguments_ })

      return view
    },
    orderBy: (...arguments_: unknown[]) => {
      operations.push({ kind: 'order', arguments_ })

      return view
    },
    limit: (limit: number) => {
      operations.push({ kind: 'limit', arguments_: [limit] })

      return view
    },
    skip: (skip: number) => {
      operations.push({ kind: 'skip', arguments_: [skip] })

      return view
    },
  }

  return { view, operations }
}

/**
Replay one recorded sort/page operation onto the WITH clause that trims
the related rows (a statement renders its own RETURN before its ORDER BY /
LIMIT, so the trim cannot ride the RETURN)
*/
function replayTrimOperation(
  sub: Builder,
  nodeVariable: string,
  operation: RecordedRelationOperation,
): void {
  switch (operation.kind) {
    case 'order': {
      sub.withOrder(...relationOrderArguments(nodeVariable, operation.arguments_))

      break
    }
    case 'skip': {
      const skip = operation.arguments_[0]

      if (typeof skip === 'number') {
        sub.withSkip(skip)
      }

      break
    }
    case 'limit': {
      const limit = operation.arguments_[0]

      if (typeof limit === 'number') {
        sub.withLimit(limit)
      }

      break
    }
    case 'where': {
      break
    }
  }
}

/**
Emit the per-relation CALL subqueries a decorated load spec renders
(NTS-560): one `CALL { WITH this MATCH (this)-[...]-(node) WHERE … WITH
node ORDER BY … SKIP/LIMIT RETURN collect(node { projection }) AS
<key>_loaded }` per callback, placed before the RETURN so the projection
map reads the collected values.

Pattern comprehensions (the fragment a plain `true` request renders)
cannot carry ORDER BY / LIMIT — the subquery is the pragmatic shape that
keeps one statement, ordered/limited related reads, and full hydration.
*/
export function loadSpecCalls(
  builder: Builder,
  alias: string,
  schema: EntitySchema,
  withSpec: object | undefined,
): void {
  if (withSpec === undefined) {
    return
  }

  for (const relationship of schema.getRelationships()) {
    const callback = requestedSpec(withSpec, relationship.getKey())

    // Plain requests render as the standard comprehension fragment in
    // projectionNode — no subquery
    if (callback === undefined || callback === true) {
      continue
    }

    const key = relationship.getKey()
    const target = relationship.getTarget()
    const targetSchema = getModel(target) as EntitySchema | undefined

    // A relationship-entity target needs its rel properties + type marker
    // in the collected value — the node projection below would lose them
    if (
      !(targetSchema instanceof EntitySchema) ||
      targetSchema.getType() === EntityType.RelationshipEntity
    ) {
      throw new NeodeError(
        `The load spec ("with") callback for "${key}" decorates relationships to node models only`,
      )
    }

    const nodeVariable = `${alias}_${key}_node`
    const { view, operations } = relationQuery()

    callback(view)

    builder.call((sub) => {
      sub.with(alias)
      sub.match(alias)
      sub
        .relationship(relationship.getType(), relationship.getDirection(), `${alias}_${key}_rel`)
        .to(nodeVariable, targetSchema.getLabels())

      // Wheres filter the MATCH; the sort/page trim rides the WITH clause
      // (a statement renders its own RETURN before its ORDER BY / LIMIT)
      for (const operation of operations) {
        if (operation.kind !== 'where') {
          continue
        }

        const [property, ...rest] = operation.arguments_

        sub.where(
          typeof property === 'string' ? relationProperty(nodeVariable, property) : property,
          ...rest,
        )
      }

      sub.with(nodeVariable)

      for (const operation of operations) {
        replayTrimOperation(sub, nodeVariable, operation)
      }

      sub.return(
        `collect(${nodeVariable} { .*, ${EAGER_ID}: elementId(${nodeVariable}), ` +
          `${EAGER_LABELS}: labels(${nodeVariable}) }) AS ${loadSpecAlias(alias, key)}`,
      )

      return sub
    })
  }
}

/**
The RETURN map projection for a model's read query: all properties, the
hydration identity markers, full-entity eager relationships and every
projected property — one query per read.

`withSpec` (NTS-560) additionally renders requested non-eager
relationships: `true` renders the standard comprehension fragment, a
decorating callback renders `key: <key>_loaded` (`[0]` for singular) —
the alias the CALL subquery loadSpecCalls() published. Requested keys
count as loaded: the hydrated values materialize as own properties
through the regular eager hydration path.
*/
export function projectionNode(alias: string, schema: EntitySchema, withSpec?: object): string {
  validateWithSpec(schema, withSpec)

  const parts: string[] = [
    '.*',
    `${EAGER_ID}: elementId(${alias})`,
    `${EAGER_LABELS}: labels(${alias})`,
  ]

  // Requested fragments render first, so a decorated key overrides the
  // default eager pattern
  for (const relationship of schema.getRelationships()) {
    const isRequested = withSpec !== undefined && Object.hasOwn(withSpec, relationship.getKey())

    if (!isRequested) {
      continue
    }

    const key = relationship.getKey()
    const requested = requestedSpec(withSpec, key)

    if (requested === true) {
      parts.push(eagerPattern(1, alias, relationship))

      continue
    }

    if (requested !== undefined) {
      parts.push(`${key}: ${loadSpecAlias(alias, key)}${relationship.getMany() ? '' : '[0]'}`)
    }
  }

  // Full-entity eager relationships (existing eager machinery)
  for (const relationship of schema.getRelationships()) {
    const isRequested = withSpec !== undefined && Object.hasOwn(withSpec, relationship.getKey())

    if (isRequested || !relationship.getEager()) {
      continue
    }

    parts.push(eagerPattern(1, alias, relationship))
  }

  // Projected read-model properties
  for (const property of schema.getProperties()) {
    if (isProjectedProperty(property) && property.getType() !== PropertyType.COMPUTED) {
      parts.push(projectedProperty(alias, property))
    }
  }

  return `${alias} { ${parts.join(', ')} }`
}
