import {
  DateTime,
  Date as DriverDate,
  Duration,
  isDate,
  isDateTime,
  isDuration,
  isInt,
  isLocalDateTime,
  isLocalTime,
  isPoint,
  isTime,
  LocalDateTime,
  LocalTime,
  Point,
  Time,
} from 'neo4j-driver'
import { ELEMENT_ID } from './constants.js'
import { NeodeError, RelationNotLoadedError } from './errors/index.js'
import { isStrictRelationAccess } from './strict-relation-access.js'
import type { GraphNode, GraphRelationship } from './driver/types.js'
import { elementIdOfEntity } from './element-id.js'
import { applyEntityMethods, type WithMethods } from './entity-methods.js'
import type { EntitySchema } from './meta/entity/entity-schema.js'
import { EntityType } from './meta/entity/entity-schema.js'
import { getModel } from './meta/index.js'
import type { Newable } from './meta/newable.js'
import type { PropertySchema } from './meta/property-schema.js'
import { isProjectedProperty, PropertyType } from './meta/property-schema.js'
import type { RelationshipPropertySchema } from './meta/relationship-property-schema.js'
import { EAGER_ID, EAGER_LABELS, EAGER_TYPE } from './query/eager-utilities.js'
import { type Builder, Direction } from './query/index.js'
import { isGraphNode, isRecord } from './services/type-guards.js'

export interface EagerNode {
  node: GraphNode
  eager?: Record<string, unknown>
}

export interface EagerRelationship {
  rel?: GraphRelationship
  start?: EagerNode
  end?: EagerNode
  other: EagerNode
}

/**
An eager projection map, as produced by the eagerNode/eagerPattern Cypher
builders: node or relationship properties inline, plus the __EAGER_ID__
(and __EAGER_LABELS__ / __EAGER_TYPE__) markers, plus one key per eager
relationship holding the nested projection value(s).
*/
export type EagerProjectionMap = Record<string, unknown>

/**
The values neode skipped wholesale when reading an eager value off the
projection: absent, null, or the falsy primitives.
*/
function isHydratedEntity<T>(
  value: unknown,
  constructor: Newable,
): value is WithMethods<T> & Record<string, unknown> {
  return value instanceof constructor
}

function isEagerProjectionMap(value: unknown): value is EagerProjectionMap {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, EAGER_ID)
  )
}

/**
Read-side property hydration (NTS-139): a stored/projected `null` hydrates
as `undefined` — a Neo4j property is either present or absent, null never
persists, so `undefined` is the honest shape for "not set" (graphacademy's
`?? undefined` convention). A `coalesce` config then supplies fallbacks:
a literal, or sibling property names whose first non-null value wins.
*/
function hydrateScalarProperty(
  property: PropertySchema,
  values: Record<string, unknown>,
  modelName: string,
): unknown {
  const value = values[property.getKey()]

  if (value !== null && value !== undefined) {
    return applyOutTransform(property, value, modelName)
  }

  const coalesce = property.getCoalesce()

  if (coalesce === undefined) {
    return undefined
  }

  if (typeof coalesce === 'string') {
    return coalesce
  }

  for (const key of coalesce) {
    const fallback = values[key]

    if (fallback !== null && fallback !== undefined) {
      return applyOutTransform(property, fallback, modelName)
    }
  }

  return undefined
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
Apply the property's `out` transform (NTS-449): stored form -> value, at
hydration. Transforms must be synchronous — hydration is a synchronous
pass — and failures name the model and property.
*/
function applyOutTransform(property: PropertySchema, value: unknown, modelName: string): unknown {
  const transform = property.getTransform()?.out

  if (transform === undefined) {
    return value
  }

  let transformed: unknown

  try {
    transformed = transform(value)
  } catch (error) {
    throw new NeodeError(
      `The out transform for property "${property.getKey()}" on ${modelName} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  if (isThenable(transformed)) {
    throw new NeodeError(
      `The property "${property.getKey()}" on ${modelName} declares an async "out" transform — out transforms must be synchronous (hydration is a synchronous pass)`,
    )
  }

  return transformed
}

/**
Hydrate one node property of a regular (non-relationship) node hydration:
structural property kinds read the raw node shapes, everything else is a
scalar (or a projected read-model value kept in its raw shape)
*/
function hydrateNodeProperty(
  property: PropertySchema,
  node: GraphNode | EagerProjectionMap,
  elementId: string | undefined,
  properties: Record<string, unknown>,
  modelName: string,
): unknown {
  switch (property.getType()) {
    case PropertyType.INTERNAL_ID: {
      return elementId
    }

    case PropertyType.ALL_PROPERTIES: {
      return properties
    }

    case PropertyType.NODE: {
      return node
    }

    case PropertyType.ANY:
    case PropertyType.UUID:
    case PropertyType.STRING:
    case PropertyType.INTEGER:
    case PropertyType.FLOAT:
    case PropertyType.NUMBER:
    case PropertyType.BOOLEAN:
    case PropertyType.DATE:
    case PropertyType.TIME:
    case PropertyType.DATETIME:
    case PropertyType.LOCALTIME:
    case PropertyType.LOCALDATETIME:
    case PropertyType.POINT:
    case PropertyType.DURATION:
    case PropertyType.ONE_TO_ONE:
    case PropertyType.ONE_TO_MANY:
    case PropertyType.RELATED_ONE:
    case PropertyType.RELATED_MANY:
    case PropertyType.RELATIONSHIP_COUNT:
    case PropertyType.RELATIONSHIP_EXISTS:
    case PropertyType.LABEL_PRESENT:
    case PropertyType.COMPUTED:
    case PropertyType.EXPRESSION:
    case PropertyType.START_NODE:
    case PropertyType.END_NODE:
    case PropertyType.OTHER_NODE:
    case PropertyType.RELATIONSHIP: {
      // Projected read-model values keep their raw shape — the
      // projection layer post-processes them and a related-one
      // miss stays null; stored scalars get hydration defaults
      return isProjectedProperty(property)
        ? properties[property.getKey()]
        : hydrateScalarProperty(property, properties, modelName)
    }
  }
}

export function hydrateNode<T>(
  targetSchema: EntitySchema,
  targetEntity: Newable,
  node: GraphNode | EagerProjectionMap,
  eager: Record<string, unknown> = {},
): WithMethods<T> {
  // Wire the active-record instance methods onto the class prototype
  // (idempotent) so hydrated instances can save/update/delete themselves
  applyEntityMethods(targetEntity)

  const constructed: unknown = new targetEntity()

  if (!isHydratedEntity<T>(constructed, targetEntity)) {
    throw new TypeError('Hydration did not produce an entity object')
  }

  // The write view (a plain record) and the typed view of the SAME object
  const entity: Record<string, unknown> = constructed

  // A projection map carries its properties inline with the markers and
  // eager relationship values; a driver node keeps the plain shapes
  const isProjection = isEagerProjectionMap(node)

  let elementId: string | undefined
  let properties: Record<string, unknown>
  let eagerValues: Record<string, unknown>

  if (isProjection) {
    const marker: unknown = node[EAGER_ID]
    elementId = typeof marker === 'string' ? marker : undefined

    // Everything except the reserved markers and the eager relationship
    // keys is a node property
    const reserved = new Set<string>([EAGER_ID, EAGER_LABELS, EAGER_TYPE])

    for (const relationship of targetSchema.getRelationships()) {
      reserved.add(relationship.getKey())
    }

    properties = Object.fromEntries(Object.entries(node).filter(([key]) => !reserved.has(key)))

    eagerValues = node
  } else {
    elementId = node.elementId
    properties = node.properties
    eagerValues = eager
  }

  // Stash the elementId so matching works without the deprecated
  // @InternalId property (non-enumerable: not data — must not leak into
  // serialisation or structural copies)
  if (elementId !== undefined && elementId !== '') {
    Object.defineProperty(entity, ELEMENT_ID, { value: elementId })
  }

  for (const property of targetSchema.getProperties()) {
    entity[property.getKey()] = hydrateNodeProperty(
      property,
      node,
      elementId,
      properties,
      targetEntity.name,
    )
  }

  // Hydrate Eager Relationships
  for (const relationship of targetSchema.getRelationships()) {
    const key = relationship.getKey()

    if (!Object.hasOwn(eagerValues, key)) {
      continue
    }

    const value: unknown = eagerValues[key]

    // neode skipped absent and falsy eager values wholesale
    if (
      value === undefined ||
      value === null ||
      value === false ||
      value === '' ||
      value === 0 ||
      Number.isNaN(value)
    ) {
      // The load spec requested the relation and the graph answered
      // empty: materialize the loaded-and-empty shape ([] for many,
      // undefined for one) so strict access can tell it apart from
      // "not loaded" (NTS-155)
      entity[key] = relationship.getMany() ? [] : undefined

      continue
    }

    // Check type - is this a node entity or a relationship entity?
    const targetEntity = relationship.getTarget()
    const targetSchema = getModel(targetEntity)

    const values: unknown[] = Array.isArray(value) ? value : [value]
    const hydrated = values.map((item) => {
      if (!isRecord(item)) {
        throw new TypeError('Cannot hydrate an eager relationship value that is not an object')
      }

      return targetSchema.getType() === EntityType.RelationshipEntity
        ? hydrateRelationship(targetSchema, targetEntity, item, relationship, entity)
        : hydrateEagerTargetNode(targetSchema, targetEntity, item)
    })

    if (relationship.getMany()) {
      entity[key] = hydrated
    } else {
      // An empty singular result is loaded-and-empty (undefined), not
      // "not loaded" — assign so the own property exists (NTS-155)
      entity[key] = hydrated[0]
    }
  }

  // Strict relation access (NTS-155): relationships the load spec did not
  // request are guarded by a prototype accessor — reading one throws
  // RelationNotLoadedError in strict mode, stays undefined otherwise.
  // Loaded values are own instance properties and shadow the accessor, so
  // loaded-and-empty shapes read back fine.
  installRelationAccessors(targetEntity, targetSchema)

  for (const relationship of targetSchema.getRelationships()) {
    // Static eager relationships count as loaded, and keys the load spec
    // requested were materialized above (possibly as [] or undefined)
    if (relationship.getEager() || Object.hasOwn(eagerValues, relationship.getKey())) {
      continue
    }

    // A decorator-declared field constructs an own undefined — remove it
    // so the prototype accessor shows through and the guard can fire
    const key = relationship.getKey()

    if (Object.hasOwn(entity, key) && entity[key] === undefined) {
      Reflect.deleteProperty(entity, key)
    }
  }

  return constructed
}

const RELATION_ACCESSORS_APPLIED = Symbol('neode:relation-accessors-applied')

/**
Install the unloaded-relation guards on an entity class's PROTOTYPE
(idempotent, once per constructor): one accessor per non-eager
relationship key. Loaded relationships are own instance properties and
shadow the accessor — the accessor only ever answers for unloaded ones,
with RelationNotLoadedError in strict mode and undefined otherwise. Its
setter materializes the assigned value as an own property, so later
hydration passes and user assignments load through normally.
*/
function installRelationAccessors(constructor: Newable, schema: EntitySchema): void {
  const prototype: unknown = constructor.prototype

  if (
    typeof prototype !== 'object' ||
    prototype === null ||
    Object.hasOwn(prototype, RELATION_ACCESSORS_APPLIED)
  ) {
    return
  }

  for (const relationship of schema.getRelationships()) {
    // Static eager relationships are requested by every read query —
    // they count as loaded, no guard
    if (relationship.getEager()) {
      continue
    }

    const key = relationship.getKey()

    // A user-declared prototype member wins — partial adoption,
    // no clobbering (as with the entity instance methods)
    if (Object.hasOwn(prototype, key)) {
      continue
    }

    Object.defineProperty(prototype, key, {
      enumerable: false,
      configurable: true,
      get(this: object) {
        // Lenient mode (the default): neode-style `undefined`
        if (!isStrictRelationAccess()) {
          return
        }

        throw new RelationNotLoadedError(constructor.name, key)
      },
      set(this: object, value: unknown) {
        Object.defineProperty(this, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        })
      },
    })
  }

  Object.defineProperty(prototype, RELATION_ACCESSORS_APPLIED, {
    value: true,
    enumerable: false,
  })
}

/**
Hydrate one eager value for a node-entity target. Projection maps hydrate
recursively; the legacy hand-built shape ({rel, start, end, other}) hydrates
from its `other` node.
*/
function hydrateEagerTargetNode(
  targetSchema: EntitySchema,
  targetEntity: Newable,
  item: unknown,
): unknown {
  if (isEagerProjectionMap(item)) {
    return hydrateNode(targetSchema, targetEntity, item)
  }

  if (!isRecord(item)) {
    throw new TypeError('The eager relationship value must be an object')
  }

  const other: unknown = item['other']

  if (!isRecord(other)) {
    throw new TypeError('The eager relationship value must carry an "other" node')
  }

  const otherNode: unknown = other['node']

  if (!isGraphNode(otherNode)) {
    throw new TypeError('The eager relationship value must carry an "other" node')
  }

  const eager: unknown = other['eager']

  return hydrateNode(targetSchema, targetEntity, otherNode, isRecord(eager) ? eager : {})
}

/**
Hydrate one property of a relationship entity read off an eager
projection map: structural relationship kinds read the projection record,
node kinds read the far-record projection, everything else is a scalar
*/
function hydrateProjectionProperty(
  property: PropertySchema,
  record: EagerProjectionMap,
  properties: Record<string, unknown>,
  farRecord: unknown,
  direction: Direction,
  parent: unknown,
  modelName: string,
): unknown {
  switch (property.getType()) {
    case PropertyType.INTERNAL_ID: {
      return record[EAGER_ID]
    }

    case PropertyType.RELATIONSHIP: {
      // A projection carries no driver relationship object;
      // the raw map is the closest equivalent
      return record
    }

    case PropertyType.START_NODE:
    case PropertyType.END_NODE:
    case PropertyType.OTHER_NODE: {
      // The node at the far end of the pattern is the one
      // projected in the map; the near node is the entity
      // this relationship hangs off
      const isIncoming = direction === Direction.INCOMING
      const isFar =
        property.getType() === PropertyType.OTHER_NODE ||
        (property.getType() === PropertyType.START_NODE ? isIncoming : !isIncoming)

      if (!isFar) {
        return parent
      }

      if (!isRecord(farRecord)) {
        throw new Error(
          `Cannot hydrate ${String(property.getType())} property "${property.getKey()}": missing node in eager data`,
        )
      }

      const targetEntity = property.getEntity()

      if (targetEntity === undefined) {
        throw new Error(
          `Cannot hydrate ${String(property.getType())} property "${property.getKey()}": no target entity`,
        )
      }

      return hydrateNode(getModel(targetEntity), targetEntity, farRecord)
    }

    case PropertyType.ANY:
    case PropertyType.ALL_PROPERTIES:
    case PropertyType.UUID:
    case PropertyType.STRING:
    case PropertyType.INTEGER:
    case PropertyType.FLOAT:
    case PropertyType.NUMBER:
    case PropertyType.BOOLEAN:
    case PropertyType.DATE:
    case PropertyType.TIME:
    case PropertyType.DATETIME:
    case PropertyType.LOCALTIME:
    case PropertyType.LOCALDATETIME:
    case PropertyType.POINT:
    case PropertyType.DURATION:
    case PropertyType.ONE_TO_ONE:
    case PropertyType.ONE_TO_MANY:
    case PropertyType.RELATED_ONE:
    case PropertyType.RELATED_MANY:
    case PropertyType.RELATIONSHIP_COUNT:
    case PropertyType.RELATIONSHIP_EXISTS:
    case PropertyType.LABEL_PRESENT:
    case PropertyType.COMPUTED:
    case PropertyType.EXPRESSION:
    case PropertyType.NODE: {
      return hydrateScalarProperty(property, properties, modelName)
    }
  }
}

/**
Hydrate one property of a relationship entity read off the legacy
hand-built eager shape ({rel, start, end, other})
*/
function hydrateLegacyRelationshipProperty(
  property: PropertySchema,
  graphRelationship: GraphRelationship,
  start: EagerNode,
  end: EagerNode,
  other: EagerNode,
  modelName: string,
): unknown {
  switch (property.getType()) {
    case PropertyType.INTERNAL_ID: {
      return graphRelationship.elementId
    }

    case PropertyType.RELATIONSHIP: {
      return graphRelationship
    }

    case PropertyType.START_NODE:
    case PropertyType.END_NODE:
    case PropertyType.OTHER_NODE: {
      const eagerEntity = property.getEntity()

      if (eagerEntity === undefined) {
        throw new Error(
          `Cannot hydrate ${String(property.getType())} property "${property.getKey()}": no target entity`,
        )
      }

      const eagerSchema = getModel(eagerEntity)

      let innerNode: GraphNode | undefined
      let innerEager: Record<string, unknown> = {}

      // Work out which node to hydrate
      if (property.getType() === PropertyType.START_NODE) {
        innerNode = start.node
        innerEager = start.eager ?? {}
      } else if (property.getType() === PropertyType.END_NODE) {
        innerNode = end.node
        innerEager = end.eager ?? {}
      } else if (property.getType() === PropertyType.OTHER_NODE) {
        innerNode = other.node
        innerEager = other.eager ?? {}
      }

      if (!innerNode) {
        throw new Error(
          `Cannot hydrate ${String(property.getType())} property "${property.getKey()}": missing node in eager data`,
        )
      }

      return hydrateNode(eagerSchema, eagerEntity, innerNode, innerEager)
    }

    case PropertyType.ANY:
    case PropertyType.ALL_PROPERTIES:
    case PropertyType.UUID:
    case PropertyType.STRING:
    case PropertyType.INTEGER:
    case PropertyType.FLOAT:
    case PropertyType.NUMBER:
    case PropertyType.BOOLEAN:
    case PropertyType.DATE:
    case PropertyType.TIME:
    case PropertyType.DATETIME:
    case PropertyType.LOCALTIME:
    case PropertyType.LOCALDATETIME:
    case PropertyType.POINT:
    case PropertyType.DURATION:
    case PropertyType.ONE_TO_ONE:
    case PropertyType.ONE_TO_MANY:
    case PropertyType.RELATED_ONE:
    case PropertyType.RELATED_MANY:
    case PropertyType.RELATIONSHIP_COUNT:
    case PropertyType.RELATIONSHIP_EXISTS:
    case PropertyType.LABEL_PRESENT:
    case PropertyType.COMPUTED:
    case PropertyType.EXPRESSION:
    case PropertyType.NODE: {
      return hydrateScalarProperty(property, graphRelationship.properties, modelName)
    }
  }
}

export function hydrateRelationship<T>(
  targetSchema: EntitySchema,
  targetEntity: Newable,
  relationshipObject: EagerRelationship | EagerProjectionMap,
  relationship?: RelationshipPropertySchema,
  parent?: unknown,
): WithMethods<T> {
  const constructed: unknown = new targetEntity()

  if (!isHydratedEntity<T>(constructed, targetEntity)) {
    throw new TypeError('Hydration did not produce an entity object')
  }

  // The write view (a plain record) and the typed view of the SAME object
  const entity: Record<string, unknown> = constructed

  // Eager projection shape: relationship properties inline with the
  // __EAGER_ID__ / __EAGER_TYPE__ markers, and the node at the far end
  // of the relationship projected under the parent relationship's key
  if (isEagerProjectionMap(relationshipObject)) {
    if (relationship === undefined) {
      throw new Error(
        `Cannot hydrate the relationship entity "${targetEntity.name}" from an eager projection: the parent relationship schema is missing`,
      )
    }

    const record = relationshipObject
    const direction = relationship.getDirection()
    const relationshipKey = relationship.getKey()
    const farRecord: unknown = record[relationshipKey]

    const properties = Object.fromEntries(
      Object.entries(record).filter(
        ([key]) => ![EAGER_ID, EAGER_TYPE, relationshipKey].includes(key),
      ),
    )

    for (const property of targetSchema.getProperties()) {
      entity[property.getKey()] = hydrateProjectionProperty(
        property,
        record,
        properties,
        farRecord,
        direction,
        parent,
        targetEntity.name,
      )
    }

    return constructed
  }

  // Legacy hand-built shape: { rel, start, end, other }
  const graphRelationship = relationshipObject.rel
  const start = relationshipObject.start
  const end = relationshipObject.end

  if (graphRelationship === undefined || start === undefined || end === undefined) {
    throw new Error(
      `Cannot hydrate the relationship entity "${targetEntity.name}": the eager relationship is missing its rel/start/end columns`,
    )
  }

  const other = relationshipObject.other

  for (const property of targetSchema.getProperties()) {
    entity[property.getKey()] = hydrateLegacyRelationshipProperty(
      property,
      graphRelationship,
      start,
      end,
      other,
      targetEntity.name,
    )
  }

  return constructed
}

export function setPropertyInBuilder(
  builder: Builder,
  alias: string,
  property: PropertySchema,
  value: unknown,
  target: 'node' | 'relationship' = 'node',
): Builder {
  if (value === undefined || value === null) {
    // Un-set via `SET this.prop = null` — Cypher removes the property,
    // and real Neo4j 5 rejects the `DELETE this.prop` spelling (only
    // nodes / relationships are deletable, 22NB1); the embedded engine
    // accepted either
    return builder.set(`${alias}.${property.getKey()}`, null)
  }

  // Ignore Internal IDs, properties and nodes
  if (
    property.getType() === PropertyType.INTERNAL_ID ||
    property.getType() === PropertyType.ALL_PROPERTIES ||
    property.getType() === PropertyType.NODE
  ) {
    return builder
  }

  // Vector properties persist through Neo4j's space-efficient vector
  // storage procedure (NTS-449); the ON CREATE SET / ON MATCH SET
  // variants do not apply to procedure calls
  if (property.getVector() !== undefined) {
    return builder.setVectorProperty(alias, property.getKey(), value, target)
  }

  // TODO: Handle complex types (temporals, points) — Phase 4
  const set = `${alias}.${property.getKey()}`

  // Only set primary key on create
  if (property.isPrimaryKey()) {
    builder.onCreateSet(set, value)

    return builder
  }

  // On create set
  if (property.getOnCreateSet()) {
    builder.onCreateSet(set, value)
  }

  // On match set
  if (property.getOnMatchSet()) {
    builder.onMatchSet(set, value)
  }

  // Always set
  if (
    (!property.getOnCreateSet() && !property.getOnMatchSet()) ||
    property.getAlwaysSet() ||
    property.isUnique()
  ) {
    builder.set(set, value)
  }

  return builder
}

/**
Match criteria for an entity in a write query: prefer the hydrated
elementId (stable, always present on persisted entities), falling back to
the primary key property value (neode matched instances by internal id;
elementId is its modern, portable equivalent).
*/
export function matchCriteriaForEntity(
  schema: EntitySchema,
  entity: object,
): { elementId?: string; key: string; value: unknown } {
  const primaryKey = schema.getPrimaryKey()
  const elementId = elementIdOfEntity(schema, entity)

  if (elementId !== undefined) {
    // key / value describe the pk fallback match, used only when the
    // caller cannot match by elementId
    return {
      elementId,
      key: primaryKey?.getKey() ?? '',
      value: primaryKey === undefined ? undefined : Reflect.get(entity, primaryKey.getKey()),
    }
  }

  if (primaryKey === undefined) {
    throw new Error('Cannot match an entity with no primary key and no elementId')
  }

  const value: unknown = Reflect.get(entity, primaryKey.getKey())

  if (value === undefined) {
    throw new Error(
      `Cannot match an entity without a primary key value for "${primaryKey.getKey()}". Did you save it first?`,
    )
  }

  return { key: primaryKey.getKey(), value }
}

export function getValuesAsRecord(
  model: object,
  properties: PropertySchema[],
  schema?: EntitySchema,
): Record<string, unknown> {
  if (schema === undefined) {
    throw new TypeError('getValuesAsRecord requires the entity schema')
  }

  return Object.fromEntries(
    properties
      .map((property): [string, unknown] | undefined => {
        const key = property.getKey()

        // Merge matching only uses explicitly-set values:
        // resolving defaults here would generate a new value
        // (e.g. a fresh UUID) on every save and never match
        if (Object.hasOwn(model, key)) {
          const value: unknown = Reflect.get(model, key)

          if (value !== undefined) {
            return [key, value]
          }
        }

        return undefined
      })
      .filter((entry) => entry !== undefined),
  )
}

export function getValueOrDefault(
  model: object,
  property: PropertySchema,
  schema: EntitySchema,
): unknown {
  const key = property.getKey()

  if (Object.hasOwn(model, key)) {
    const ownValue: unknown = Reflect.get(model, key)

    if (ownValue !== undefined) {
      return ownValue
    }
  }

  const defaultValue = property.getDefaultValue()

  return typeof defaultValue === 'function' ? defaultValue(model, schema) : defaultValue
}

/**
Spatial Reference System Identifiers used by Neo4j for point properties

@see https://neo4j.com/docs/cypher/current/syntax/spatial/
*/
const SRID = {
  CARTESIAN_2D: 7203,
  CARTESIAN_3D: 9157,
  WGS_84_2D: 4326,
  WGS_84_3D: 4979,
} as const

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value)
}

function describeValue(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value)
}

function isDriverValue(value: unknown): boolean {
  return (
    isDate(value) ||
    isDateTime(value) ||
    isDuration(value) ||
    isInt(value) ||
    isLocalDateTime(value) ||
    isLocalTime(value) ||
    isPoint(value) ||
    isTime(value)
  )
}

/**
Convert a value into a Neo4j temporal value. Strings are parsed by the
driver (exact, timezone-safe), numbers are treated as epoch milliseconds
and JavaScript Dates are converted with the driver's fromStandardDateLocal().
Any other value is returned unchanged.
*/
function convertTemporal(
  value: unknown,
  fromString: (value: string) => unknown,
  fromStandardDate: (date: Date) => unknown,
): unknown {
  if (typeof value === 'string') {
    return fromString(value)
  }

  if (typeof value === 'number') {
    return fromStandardDate(new Date(value))
  }

  if (value instanceof Date) {
    return fromStandardDate(value)
  }

  return value
}

function convertPoint(value: unknown): unknown {
  if (!isRecord(value)) {
    throw new TypeError(
      `Cannot convert ${describeValue(value)} to a neo4j Point: expected an object`,
    )
  }

  const { x, y, z, latitude, longitude, height } = value

  // Cartesian coordinates
  if (isNumber(x)) {
    if (!isNumber(y)) {
      throw new TypeError(
        'Cannot convert object to a neo4j Point: expected a numeric "y" to accompany "x"',
      )
    }

    return isNumber(z) ? new Point(SRID.CARTESIAN_3D, x, y, z) : new Point(SRID.CARTESIAN_2D, x, y)
  }

  // WGS 84 (geographic) coordinates: Neo4j stores longitude as x, latitude as y
  if (isNumber(latitude) || isNumber(longitude)) {
    if (!isNumber(latitude) || !isNumber(longitude)) {
      throw new TypeError(
        'Cannot convert object to a neo4j Point: expected numeric "latitude" and "longitude"',
      )
    }

    return isNumber(height)
      ? new Point(SRID.WGS_84_3D, longitude, latitude, height)
      : new Point(SRID.WGS_84_2D, longitude, latitude)
  }

  throw new TypeError(
    'Cannot convert object to a neo4j Point: expected { x, y[, z] } or { latitude, longitude[, height] }',
  )
}

function convertDuration(value: unknown): unknown {
  if (!isRecord(value)) {
    throw new TypeError(
      `Cannot convert ${describeValue(value)} to a neo4j Duration: expected an object`,
    )
  }

  const { months, days, seconds, nanoseconds } = value

  if (!isNumber(months) || !isNumber(days) || !isNumber(seconds) || !isNumber(nanoseconds)) {
    throw new TypeError(
      'Cannot convert object to a neo4j Duration: expected numeric { months, days, seconds, nanoseconds }',
    )
  }

  return new Duration(months, days, seconds, nanoseconds)
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)

    return Number.isNaN(parsed) ? undefined : parsed
  }

  return undefined
}

function convertInteger(value: unknown): number {
  const parsed = parseNumber(value)

  if (parsed === undefined || !Number.isSafeInteger(parsed)) {
    throw new TypeError(`Expected an integer, received ${describeValue(value)}`)
  }

  return parsed
}

function convertFloat(value: unknown): number {
  const parsed = parseNumber(value)

  if (parsed === undefined) {
    throw new TypeError(`Expected a number, received ${describeValue(value)}`)
  }

  return parsed
}

function convertSingleValue(value: unknown, type: PropertyType): unknown {
  // Nullish values indicate an un-set property; unsetting is handled upstream
  if (value === null || value === undefined) {
    return value
  }

  // Values that are already Neo4j driver instances pass through untouched
  if (isDriverValue(value)) {
    return value
  }

  switch (type) {
    case PropertyType.DATE: {
      return convertTemporal(
        value,
        (stringValue) => DriverDate.fromString(stringValue),
        (date) => DriverDate.fromStandardDateLocal(date),
      )
    }

    case PropertyType.TIME: {
      return convertTemporal(
        value,
        (stringValue) => Time.fromString(stringValue),
        (date) => Time.fromStandardDate(date),
      )
    }

    case PropertyType.DATETIME: {
      return convertTemporal(
        value,
        (stringValue) => DateTime.fromString(stringValue),
        (date) => DateTime.fromStandardDate(date),
      )
    }

    case PropertyType.LOCALTIME: {
      return convertTemporal(
        value,
        (stringValue) => LocalTime.fromString(stringValue),
        (date) => LocalTime.fromStandardDate(date),
      )
    }

    case PropertyType.LOCALDATETIME: {
      return convertTemporal(
        value,
        (stringValue) => LocalDateTime.fromString(stringValue),
        (date) => LocalDateTime.fromStandardDate(date),
      )
    }

    case PropertyType.POINT: {
      return convertPoint(value)
    }

    case PropertyType.DURATION: {
      return convertDuration(value)
    }

    case PropertyType.INTEGER: {
      return convertInteger(value)
    }

    case PropertyType.FLOAT:
    case PropertyType.NUMBER: {
      return convertFloat(value)
    }

    case PropertyType.ANY:
    case PropertyType.INTERNAL_ID:
    case PropertyType.ALL_PROPERTIES:
    case PropertyType.UUID:
    case PropertyType.STRING:
    case PropertyType.BOOLEAN:
    case PropertyType.ONE_TO_ONE:
    case PropertyType.ONE_TO_MANY:
    case PropertyType.RELATED_ONE:
    case PropertyType.RELATED_MANY:
    case PropertyType.RELATIONSHIP_COUNT:
    case PropertyType.RELATIONSHIP_EXISTS:
    case PropertyType.LABEL_PRESENT:
    case PropertyType.COMPUTED:
    case PropertyType.EXPRESSION:
    case PropertyType.START_NODE:
    case PropertyType.END_NODE:
    case PropertyType.OTHER_NODE:
    case PropertyType.NODE:
    case PropertyType.RELATIONSHIP: {
      return value
    }
  }
}

/**
Convert a JavaScript value into the matching Neo4j driver value for the
given property. Temporal strings and dates become driver temporal values,
points and durations are built from plain objects and numbers are validated
and passed through as plain numbers (the driver's Integer type is not used).

Arrays are converted element-by-element when the property is an array, and
values that need no conversion (strings, booleans, driver values, etc) are
returned unchanged.
*/
export function convertPropertyValue(value: unknown, property: PropertySchema): unknown {
  return property.isArray() && Array.isArray(value)
    ? value.map((element) => convertSingleValue(element, property.getType()))
    : convertSingleValue(value, property.getType())
}
