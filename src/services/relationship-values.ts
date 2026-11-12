import { NeodeError } from '../errors/index.js'
import { getModel } from '../meta/index.js'
import { EntitySchema, EntityType } from '../meta/entity/entity-schema.js'
import type { PropertySchema } from '../meta/property-schema.js'
import { PropertyType } from '../meta/property-schema.js'
import type { RelationshipPropertySchema } from '../meta/relationship-property-schema.js'
import { Direction } from '../query/direction.js'
import { buildPropertySchema } from '../validation/rule-table.js'
import { validate } from '../validation/index.js'
import { convertPropertyValue } from '../utilities.js'
import { isRecord } from './type-guards.js'

/**
Property types describing relationship internals, never set on the edge
*/
const INTERNAL_PROPERTY_TYPES = new Set<PropertyType>([
  PropertyType.INTERNAL_ID,
  PropertyType.START_NODE,
  PropertyType.END_NODE,
  PropertyType.OTHER_NODE,
])

/**
Relationship-value resolution for the write paths (NTS-627/628): the
shared machinery that turns the relationship values on a create/save
model — entity instances or primary-key values — into statements, and
validates runtime edge properties against the relationship's declared
`properties` schema.
*/

/**
Write paths reject Direction.BOTH up front: BOTH renders an undirected
match pattern (`-[r:T]-`), and Neo4j cannot create or merge a relationship
without a direction (NTS-483)
*/
export function assertWritableDirection(relationship: RelationshipPropertySchema): void {
  if (relationship.getDirection() === Direction.BOTH) {
    throw new NeodeError(
      `Relationship "${relationship.getKey()}" is declared with direction BOTH, which is ` +
        'match-only: Neo4j cannot create an undirected relationship. ' +
        'Set direction OUTGOING or INCOMING to write this relationship.',
    )
  }
}

/**
Validate runtime edge properties against the relationship's declared
`properties` schema (NTS-628): unknown property names and failing types
throw naming the relationship key. A relationship without a declared
schema accepts literals (relate() parity).
*/
export function validateEdgeProperties(
  relationship: RelationshipPropertySchema,
  values: Record<string, unknown>,
): void {
  const declared = relationship.getEdgeProperties()

  if (declared.length === 0) {
    return
  }

  const known = new Map(declared.map((property) => [property.getKey(), property]))

  for (const [key, value] of Object.entries(values)) {
    const property = known.get(key)

    if (property === undefined) {
      throw new NeodeError(
        `Unknown edge property "${key}" on relationship "${relationship.getKey()}" — ` +
          `declared edge properties: ${declared.map((entry) => entry.getKey()).join(', ')}. ` +
          'Add it to the relationship\'s "properties" declaration or remove it.',
      )
    }

    if (value === undefined || value === null) {
      continue
    }

    const result = buildPropertySchema(property, property.getRules()).safeParse(value)

    if (!result.success) {
      throw new NeodeError(
        `Edge property "${key}" on relationship "${relationship.getKey()}" failed validation: ${result.error.issues[0]?.message ?? 'invalid value'}`,
      )
    }
  }
}

/**
Edge-property writes are writes like any other (NTS-509): validate the
raw values against the relationship's declared `properties` schema, then
convert to the stored form through the edge entity's property schemas
when the relationship's target IS an edge entity. Internal node /
relationship references never convert. Shared by relate() and the bulk
paths.
*/
export function convertEdgeProperties(
  relationship: RelationshipPropertySchema,
  values: Record<string, unknown>,
): Record<string, unknown> {
  validateEdgeProperties(relationship, values)

  const edgeTarget = relationship.getTarget()
  const edgeSchema = typeof edgeTarget === 'function' ? getModel(edgeTarget) : undefined

  if (
    !(edgeSchema instanceof EntitySchema) ||
    edgeSchema.getType() !== EntityType.RelationshipEntity
  ) {
    return values
  }

  const converted: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      continue
    }

    const property = edgeSchema.getProperties().find((candidate) => candidate.getKey() === key)

    if (property !== undefined && INTERNAL_PROPERTY_TYPES.has(property.getType())) {
      continue
    }

    converted[key] = property === undefined ? value : convertPropertyValue(value, property)
  }

  validate(converted, edgeSchema)

  return converted
}

/**
One primary-key-value target of a create, related in the root CREATE
statement (NTS-627)
*/
export interface RootRelationshipTarget {
  relationshipKey: string
  targetSchema: EntitySchema
  /**
  The target model's primary-key property key
  */
  primaryKeyKey: string
  value: string | number
  type: string
  direction: Direction
  /**
  Node alias the target matches under
  */
  alias: string
  relAlias: string
  /**
  Edge properties rendered inline on the created edge
  */
  properties: Record<string, unknown>
}

/**
Validate a by-value relationship target and resolve the primary key it
matches on (NTS-627): string / number values only, and the target model
must declare a primary key.
*/
export function assertPkTarget(
  relationship: RelationshipPropertySchema,
  targetSchema: EntitySchema,
  value: unknown,
): PropertySchema {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new NeodeError(
      `The value of relationship "${relationship.getKey()}" must be an entity instance ` +
        `or a primary-key value (string | number) — received ${typeof value}`,
    )
  }

  const primaryKey = targetSchema.getPrimaryKey()

  if (primaryKey === undefined) {
    throw new NeodeError(
      `Cannot relate "${relationship.getKey()}" by value: the target model ` +
        `"${targetSchema.getLabels().join(':') || 'entity'}" declares no primary key — ` +
        'pass an entity instance instead',
    )
  }

  return primaryKey
}

/**
Resolve the relationship values on a create model into the root
statement's pk targets (NTS-627): non-record values on declared
relationships relate EXISTING nodes matched by the target's primary key;
entity instances keep the recursive create walk; relationship-entity
values must be records (they describe the edge AND its far node). Every
value is validated here, before any statement runs.
*/
export function resolveRootRelationshipTargets(
  schema: EntitySchema,
  model: object,
  edgeProperties: Record<string, Record<string, unknown>> = {},
): RootRelationshipTarget[] {
  if (!isRecord(model)) {
    return []
  }

  const targets: RootRelationshipTarget[] = []

  for (const relationship of schema.getRelationships()) {
    const key = relationship.getKey()

    const propertyValue: unknown = model[key]

    // If property is not set (or falsy) then ignore it
    const hasValue = Object.hasOwn(model, key) && Boolean(propertyValue)

    if (!hasValue) {
      continue
    }

    // BOTH is match-only (NTS-483) — reject before any statement runs
    assertWritableDirection(relationship)

    const values: unknown[] =
      relationship.getMany() && Array.isArray(propertyValue) ? propertyValue : [propertyValue]

    const targetEntity = relationship.getTarget()

    const targetSchema = getModel(targetEntity)

    if (!(targetSchema instanceof EntitySchema)) {
      throw new NeodeError(
        `Couldn't find a model for the target of relationship "${key}" ` +
          `(configured target: "${
            typeof targetEntity === 'function' ? targetEntity.name : 'unknown'
          }") — register it with @NodeEntity or defineModel() first.`,
      )
    }

    // Relationship-entity values describe the edge AND its far node —
    // objects only (unchanged shape)
    if (targetSchema.getType() === EntityType.RelationshipEntity) {
      for (const value of values) {
        if (!isRecord(value)) {
          throw new TypeError(`The value of relationship "${key}" must be an object to create`)
        }
      }

      continue
    }

    const inlineProperties = edgeProperties[key] ?? {}

    for (const [index, value] of values.entries()) {
      // Entity instance: the recursive create walk handles it
      if (isRecord(value)) {
        continue
      }

      // Not a pk value: assertPkTarget throws the full error message —
      // this call narrows the value for the target pushed below
      if (typeof value !== 'string' && typeof value !== 'number') {
        assertPkTarget(relationship, targetSchema, value)
        continue
      }

      const primaryKey = assertPkTarget(relationship, targetSchema, value)

      targets.push({
        relationshipKey: key,
        targetSchema,
        primaryKeyKey: primaryKey.getKey(),
        value,
        type: relationship.getType(),
        direction: relationship.getDirection(),
        alias: `${key}_${String(index)}_target`,
        relAlias: `${key}_${String(index)}_rel`,
        properties: inlineProperties,
      })
    }
  }

  return targets
}

/**
Unknown keys on a create model throw (NTS-627): they were silently
dropped before — a typo'd relationship key wrote a node without its edge.
*/
export function assertKnownWriteKeys(schema: EntitySchema, model: object): void {
  if (!isRecord(model)) {
    return
  }

  for (const key of Object.keys(model)) {
    if (schema.hasProperty(key) || schema.hasRelationship(key)) {
      continue
    }

    throw new NeodeError(
      `Unknown property or relationship "${key}" on model "${schema.getLabels().join(':') || 'entity'}" — ` +
        'declare it on the model (@Property / @OneToOne / a definition key) or remove it from the write.',
    )
  }
}
