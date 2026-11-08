import { isInt } from 'neo4j-driver'
import { getModel } from '../meta/index.js'
import { EntitySchema } from '../meta/entity/entity-schema.js'
import type { Newable } from '../meta/newable.js'
import type { PropertySchema } from '../meta/property-schema.js'
import { PropertyType } from '../meta/property-schema.js'
import { hydrateNode } from '../utilities.js'
import { isRecord } from '../services/type-guards.js'

/**
Hydrate one row of a projection read (NTS-135/136/137/138).

The RETURN map projection (projectionNode) carries the node properties
inline with the identity markers and eager relationship values — the shape
hydrateNode understands, so projected values land on the entity through
the regular property hydration switch. This pass then post-processes the
projected kinds:

- full-entity @RelatedOne / @RelatedMany values hydrate recursively into
  entities;
- field-subset values stay the plain read-only DTOs the query returned;
- counts / exists / label predicates become primitives;
- @Computed derives its value from the hydrated entity.
*/
export function hydrateProjection<T>(
  schema: EntitySchema,
  constructor: new (...arguments_: never[]) => T,
  projection: Record<string, unknown>,
): T {
  const entity = hydrateNode<Record<string, unknown>>(schema, constructor, projection)

  for (const property of schema.getProperties()) {
    postProcessProjection(entity, property)
  }

  // hydrateNode built the entity from the model's constructor — the type
  // parameter only names it; the guard is the checked edge the strict
  // no-assertion rule requires
  if (!isModelOf(entity, constructor)) {
    throw new TypeError('hydration did not produce an entity object')
  }

  return entity
}

/**
The hydrated entity record as the caller's model type
*/
function isModelOf<T>(
  value: Record<string, unknown>,
  constructor: new (...arguments_: never[]) => T,
): value is T & Record<string, unknown> {
  // hydrateNode instantiates the model constructor, so the entity's
  // constructor is the model itself
  return value.constructor === constructor
}

/**
First occurrence per distinct value (JSON identity) — preserves order
*/
function dedupe(values: unknown[]): unknown[] {
  const seen = new Set<string>()
  const out: unknown[] = []

  for (const value of values) {
    const key = JSON.stringify(value)

    if (!seen.has(key)) {
      seen.add(key)

      out.push(value)
    }
  }

  return out
}

/**
Post-process one projected property value on the hydrated entity
*/
function postProcessProjection(entity: Record<string, unknown>, property: PropertySchema): void {
  const type = property.getType()
  const key = property.getKey()

  // Field subsets are already plain DTOs — nothing to hydrate
  if (type === PropertyType.RELATED_ONE || type === PropertyType.RELATED_MANY) {
    const fields = property.getFields()

    if (fields !== undefined && fields.length > 0) {
      // NTS-547 — multi-hop paths yield one element per matched path:
      // the same end node reached through two intermediate nodes appears
      // twice. Dedupe by value (single-hop projections cannot duplicate).
      if (property.getPath() !== undefined && Array.isArray(entity[key])) {
        entity[key] = dedupe(entity[key] as unknown[])
      }

      return
    }

    const raw = entity[key]

    if (raw === undefined || raw === null) {
      return
    }

    // Unregistered (or never-resolved lazy) target: leave the raw
    // projection in place
    const targetEntity: Newable | undefined = property.getEntity()

    if (targetEntity === undefined) {
      return
    }

    const targetSchema = getModel(targetEntity)

    // Unregistered target: leave the raw projection in place
    if (!(targetSchema instanceof EntitySchema)) {
      return
    }

    const hydrateOne = (item: unknown): unknown =>
      isRecord(item) ? hydrateNode(targetSchema, targetEntity, item) : item

    entity[key] = Array.isArray(raw) ? raw.map((item) => hydrateOne(item)) : hydrateOne(raw)

    return
  }

  if (type === PropertyType.RELATIONSHIP_COUNT) {
    const value = entity[key]

    // neo4j-driver returns COUNT as an Integer; Relate as a number
    entity[key] = isInt(value) ? value.toNumber() : Number(value)

    return
  }

  if (type === PropertyType.RELATIONSHIP_EXISTS || type === PropertyType.LABEL_PRESENT) {
    const value = entity[key]

    entity[key] = Boolean(value)

    return
  }

  if (type !== PropertyType.COMPUTED) {
    return // raw projected value already assigned
  }

  const compute = property.getCompute()

  if (compute === undefined) {
    return
  }

  entity[key] = compute(entity)
}
