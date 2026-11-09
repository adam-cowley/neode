import { Builder, Direction, RawExpression } from '../query/index.js'
import { quote } from '../query/quote.js'
import { INTERNAL_ID, THIS_NODE } from '../constants.js'
import type { Runner } from '../driver/types.js'
import { getModel } from '../meta/index.js'
import { EntitySchema, EntityType } from '../meta/entity/entity-schema.js'
import type { PropertySchema } from '../meta/property-schema.js'
import { PropertyType, isProjectedProperty } from '../meta/property-schema.js'
import type { RelationshipPropertySchema } from '../meta/relationship-property-schema.js'
import { getValueOrDefault, setPropertyInBuilder } from '../utilities.js'
import { CardinalityViolationError, NeodeError } from '../errors/index.js'
import { validate } from '../validation/index.js'
import { isRecord } from './type-guards.js'

/**
Maximum nesting depth when creating nested relationship targets
(neode WriteUtils parity)
*/
export const MAX_CREATE_DEPTH = 99

/**
Maximum nesting depth when saving nested relationship targets through
MergeService.save (NTS-597): a cyclic object graph would otherwise recurse
until the stack overflows
*/
export const MAX_SAVE_DEPTH = 99

/**
Server-side timestamp expression (NTS-165): evaluated by the database, so
clocks never drift across clients
*/
export const SERVER_TIMESTAMP = 'datetime()'

/**
The schema's @CreatedAt / @UpdatedAt property (NTS-165), or undefined —
one of each per model (the same find-first contract as getPrimaryKey())
*/
export function timestampProperty(
  schema: EntitySchema,
  kind: 'createdAt' | 'updatedAt',
): PropertySchema | undefined {
  return schema
    .getProperties()
    .find((property) => (kind === 'createdAt' ? property.isCreatedAt() : property.isUpdatedAt()))
}

/**
The schema's @Version property (NTS-158), or undefined — one per model
(the same find-first contract as timestampProperty())
*/
export function versionProperty(schema: EntitySchema): PropertySchema | undefined {
  return schema.getProperties().find((property) => property.isVersion())
}

/**
The expression bumping the node's version by exactly 1 (NTS-158): nodes
written before the feature (or outside the library) may lack the property —
coalesce gives them version 1 on their first library write
*/
export function versionBump(alias: string, key: string): string {
  return `coalesce(${alias}.${key}, 0) + 1`
}

/**
Stamp the create path's unstamped version property (NTS-158): a created
node starts at version 0, an explicitly provided value always wins
*/
function stampCreateVersion(schema: EntitySchema, properties: Record<string, unknown>): void {
  const property = versionProperty(schema)

  if (property !== undefined && properties[property.getKey()] === undefined) {
    properties[property.getKey()] = 0
  }
}

/**
Stamp the create path's unstamped timestamp properties (NTS-165): the
CREATE pattern renders `datetime()` verbatim for them (RawExpression), an
explicitly provided value always wins
*/
function stampCreateTimestamps(schema: EntitySchema, properties: Record<string, unknown>): void {
  for (const kind of ['createdAt', 'updatedAt'] as const) {
    const property = timestampProperty(schema, kind)

    if (property !== undefined && properties[property.getKey()] === undefined) {
      properties[property.getKey()] = new RawExpression(SERVER_TIMESTAMP)
    }
  }
}

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
Write-path cardinality guard (NTS-161): a `one` / `zeroOrOne` relationship
holds at most one edge per node — a write that would leave more throws
CardinalityViolationError. `many` is unrestricted. `edgeCount` is the
number of edges the relationship would hold AFTER the write (existing
edges plus the one about to be written).
*/
export function assertCardinality(
  relationship: RelationshipPropertySchema,
  edgeCount: number,
): void {
  const cardinality = relationship.getCardinality()

  if ((cardinality === 'one' || cardinality === 'zeroOrOne') && edgeCount > 1) {
    throw new CardinalityViolationError(relationship.getKey(), cardinality, edgeCount)
  }
}

/**
The relationship entity property holding the node at the far end of the
given relationship (mirrors MergeService.save)
*/
export function getOtherProperty(
  relationship: RelationshipPropertySchema,
  targetSchema: EntitySchema,
  targetEntity: unknown,
): PropertySchema {
  assertWritableDirection(relationship)

  const direction = relationship.getDirection()

  const otherProperty = targetSchema.getProperties().find((property) => {
    if (direction === Direction.OUTGOING) {
      return (
        property.getType() === PropertyType.END_NODE ||
        property.getType() === PropertyType.OTHER_NODE
      )
    }

    if (direction === Direction.INCOMING) {
      return (
        property.getType() === PropertyType.START_NODE ||
        property.getType() === PropertyType.OTHER_NODE
      )
    }

    return false
  })

  if (otherProperty === undefined) {
    const entityName = typeof targetEntity === 'function' ? targetEntity.name : 'unknown'

    throw new NeodeError(
      `Relationship entity "${entityName}" must declare a ` +
        `@StartNode or @EndNode property to be related via "${relationship.getKey()}"`,
    )
  }

  return otherProperty
}

/**
Set the relationship entity's own properties on a merged relationship
(internal node/relationship references are skipped)
*/
export function setRelationshipEntityProperties(
  builder: Builder,
  relationshipAlias: string,
  targetSchema: EntitySchema,
  entity: Record<string, unknown>,
): void {
  for (const property of targetSchema.getProperties()) {
    const key = property.getKey()

    // Ignore if not set
    if (!Object.hasOwn(entity, key)) {
      continue
    }

    const value = entity[key]
    const type = property.getType()

    // Ignore any internals
    if (
      type === PropertyType.INTERNAL_ID ||
      type === PropertyType.START_NODE ||
      type === PropertyType.END_NODE ||
      type === PropertyType.OTHER_NODE
    ) {
      continue
    }

    if (type === PropertyType.ALL_PROPERTIES) {
      const entryValues = isRecord(value) ? Object.values(value) : []

      for (const entryValue of entryValues) {
        setPropertyInBuilder(builder, relationshipAlias, property, entryValue)
      }

      continue
    }

    setPropertyInBuilder(builder, relationshipAlias, property, value)
  }
}

/**
Create a node for the given schema and model, then recursively create and
relate any nested relationship targets present on the model.

Port of neode's WriteUtils.addNodeToStatement as one statement per node:
each node is a single CREATE, related to recursively created targets by
element ID, with a depth cap guarding against runaway (e.g. cyclic) graphs.
Returns the created node's element ID.
*/
export async function createNodeAndRelationships(
  runner: Runner,
  schema: EntitySchema,
  model: object,
  depth = 0,
): Promise<string> {
  const thisId = await createNode(runner, schema, model, depth)

  await createRelationships(runner, thisId, schema, model, depth)

  return thisId
}

/**
The model's schema-known property values as the write paths apply them:
own values with schema defaults resolved (neode validates after
GenerateDefaultValues)
*/
export function modelPropertyValues(model: object, schema: EntitySchema): Record<string, unknown> {
  const values: Record<string, unknown> = {}

  for (const property of schema.getProperties()) {
    // Projected read-model values (counts, DTOs, computed) are never written
    if (isProjectedProperty(property)) {
      continue
    }

    const value = getValueOrDefault(model, property, schema)

    if (value !== undefined) {
      values[property.getKey()] = value
    }
  }

  return values
}

/**
Resolve the model's `fake` generators (NTS-444) onto the model as
explicit values, so validation and the write observe the same value.
Create-path precedence: explicit value > `default` > `fake` — a fake
only runs when both the model and the schema default leave the
property unset.
*/
export function applyFakeValues(schema: EntitySchema, model: object): void {
  if (!isRecord(model)) {
    return
  }

  for (const property of schema.getProperties()) {
    // Projected read-model values (counts, DTOs, computed) are never written
    if (isProjectedProperty(property)) {
      continue
    }

    const key = property.getKey()

    if (Object.hasOwn(model, key) && model[key] !== undefined) {
      continue
    }

    if (getValueOrDefault(model, property, schema) !== undefined) {
      continue
    }

    const fake = property.getFake()

    if (typeof fake === 'function') {
      model[key] = fake()
    }
  }
}

/**
Explicit value, then schema default, then the property's `fake`
generator (NTS-444) — the create-path value for nested relationship
targets, whose fakes cannot be resolved on the root model up front
*/
function valueWithFake(model: object, property: PropertySchema, schema: EntitySchema): unknown {
  const value = getValueOrDefault(model, property, schema)

  if (value !== undefined) {
    return value
  }

  const fake = property.getFake()

  return typeof fake === 'function' ? fake() : undefined
}

/**
Resolve the schema's embedding sugar (NTS-449) onto the write payload,
mutating it in place: when a vector property declares `from` + `provider`
and the source property is among the values being written while the
vector property itself is not provided, the provider computes the vector
(`await provider(sourceValue)`) and it becomes the vector property's
written value. Provider failures surface as a NeodeError naming
the model and property.

`dirtyKeys` (NTS-157, the tracked-save path) narrows the recompute to a
dirty source: it runs only when the source property is dirty and the
vector property itself is not — a dirty vector is the user's explicit
value and wins, while a clean source means the stored vector is still
current and no provider call is paid for. Without `dirtyKeys` (create /
untracked saves / mergeOn / bulk), a vector already present in the
payload always wins.

Returns the vector property keys whose values were recomputed — callers
with a dirty-key write set must include them, since a recomputed vector
is by definition not among the keys the instance changed.
*/
export async function applyEmbeddings(
  schema: EntitySchema,
  values: object,
  dirtyKeys?: ReadonlySet<string>,
): Promise<string[]> {
  if (!isRecord(values)) {
    return []
  }

  const modelName = schema.getLabels()[0] ?? 'unknown'

  const recomputed: string[] = []

  for (const property of schema.getProperties()) {
    const vector = property.getVector()

    if (vector?.from === undefined || vector.provider === undefined) {
      continue
    }

    const key = property.getKey()

    if (dirtyKeys === undefined) {
      // An explicitly provided vector value wins over recomputation
      if (Object.hasOwn(values, key) && values[key] !== undefined) {
        continue
      }

      // Recompute only when the source property is being written
      if (!Object.hasOwn(values, vector.from)) {
        continue
      }
    } else {
      // Tracked save (NTS-157): the vector the instance carries when the
      // source is dirty is the stale stored one — recompute over it. A
      // dirty vector is the user's explicit value and wins.
      if (dirtyKeys.has(key) || !dirtyKeys.has(vector.from)) {
        continue
      }
    }

    const source: unknown = values[vector.from]

    if (source === undefined || source === null) {
      continue
    }

    // The provider contract is a string source (NTS-449) — anything else
    // is a definition error, not silently coerced input
    if (typeof source !== 'string') {
      throw new NeodeError(
        `Cannot compute the embedding for property "${key}" on model "${modelName}": ` +
          `the source property "${vector.from}" must hold a string, received ${typeof source}`,
      )
    }

    const from: string = vector.from

    let computed: unknown

    try {
      computed = await vector.provider(source)
    } catch (error) {
      throw new NeodeError(
        `Failed to compute the embedding for property "${key}" on model "${modelName}" ` +
          `(from "${from}"): ${error instanceof Error ? error.message : String(error)}`,
        { cause: error instanceof Error ? error : undefined },
      )
    }

    // NTS-446: a dimension mismatch surfaces at the database as a cryptic
    // procedure failure — name model, property, expected and received here
    if (!Array.isArray(computed) || computed.length !== vector.dimensions) {
      throw new NeodeError(
        `Cannot compute the embedding for property "${key}" on model "${modelName}": ` +
          `the provider must return an array of ${String(vector.dimensions)} numbers ` +
          `(vector.dimensions), received ${describeEmbedding(computed)}`,
      )
    }

    values[key] = computed

    recomputed.push(key)
  }

  return recomputed
}

/**
Describe what an embedding provider returned, for the dimension-mismatch
error (shape only — no values)
*/
function describeEmbedding(value: unknown): string {
  return Array.isArray(value)
    ? `a ${String(value.length)}-dimension vector`
    : `a ${typeof value === 'object' && value !== null ? 'non-array' : typeof value}`
}

/**
A Cypher-side derived property to append to the write statement
*/
export interface DerivedSet {
  key: string
  cypher: string
}

export interface DerivedResult {
  /**
  compute-side keys whose values were (re)computed onto the payload —
  callers with a dirty-key write set must include them, since a recomputed
  value is by definition not among the keys the instance changed
  */
  recomputed: string[]
  /**
  cypher-side sets to append to the statement after the sources are written
  */
  cypherSets: DerivedSet[]
}

/**
Resolve the schema's stored derived properties (NTS-569) onto the write
payload, mirroring applyEmbeddings' semantics: a derived property declares
`from` source properties and exactly one producer — `compute` (TypeScript,
called with the entity's property record) or `cypher` (a raw expression the
database evaluates in the write statement, `this` = the written node with
the sources' new values applied).

A write that touches any source recomputes the derived property, unless the
derived property itself is explicitly provided in the same payload (an
explicit value always wins). compute-side values are written onto
`values` in place (so `in` transforms and validation see them, and the
create pattern picks them up); the returned recomputed keys join the
caller's write set. cypher-side sets are returned for the caller to append
as `SET this.key = <expression>` after the sources are written — the
database reads the post-write node, so nothing is computed client-side.

With `dirtyKeys` (tracked saves, NTS-157) the trigger narrows to dirty
sources; without it (create / mergeOn / update patches / bulk) any source
present in the payload triggers. A compute-side derivation additionally
requires EVERY source to hold a value in the payload — a partially
available source set leaves the stored value alone (an unshipped order
gains no timeToShip).
*/
export function deriveProperties(
  schema: EntitySchema,
  values: object,
  dirtyKeys?: ReadonlySet<string>,
): DerivedResult {
  const result: DerivedResult = { recomputed: [], cypherSets: [] }

  if (!isRecord(values)) {
    return result
  }

  const modelName = schema.getLabels()[0] ?? 'unknown'

  const declared = new Set(schema.getProperties().map((property) => property.getKey()))

  for (const property of schema.getProperties()) {
    const derived = property.getDerived()

    if (derived === undefined) {
      continue
    }

    const key = property.getKey()
    const sources = Array.isArray(derived.from) ? derived.from : []
    const compute = typeof derived.compute === 'function' ? derived.compute : undefined
    const cypher =
      typeof derived.cypher === 'string' && derived.cypher !== '' ? derived.cypher : undefined

    const knownSourceCount = sources.filter((source) => declared.has(source)).length

    // Definition errors are loud on every write of the model — a typo'd
    // config must not silently leave the stored value stale
    if (knownSourceCount !== sources.length || sources.length === 0) {
      throw new NeodeError(
        `Property "${key}" on model "${modelName}" declares @Derived from ` +
          `[${sources.map((source) => JSON.stringify(source)).join(', ')}] — every source must be ` +
          'a property declared on the model',
      )
    }

    const isBoth = compute !== undefined && cypher !== undefined
    const isNeither = compute === undefined && cypher === undefined

    if (isBoth || isNeither) {
      throw new NeodeError(
        `Property "${key}" on model "${modelName}" declares @Derived with ` +
          `${isBoth ? 'both' : 'neither'} compute nor cypher — exactly one is required`,
      )
    }

    // An explicitly provided derived value wins over recomputation
    const isExplicit =
      dirtyKeys === undefined
        ? Object.hasOwn(values, key) && values[key] !== undefined
        : dirtyKeys.has(key)

    if (isExplicit) {
      continue
    }

    // Trigger: any source being written (untracked) / dirty (tracked)
    const isTriggered = sources.some((source) =>
      dirtyKeys === undefined
        ? Object.hasOwn(values, source) && values[source] !== undefined
        : dirtyKeys.has(source),
    )

    if (!isTriggered) {
      continue
    }

    if (cypher !== undefined) {
      result.cypherSets.push({ key, cypher })

      continue
    }

    // compute-side: every source must hold a value in the payload — a
    // partially available source set leaves the stored value alone
    const isAvailable = sources.every(
      (source) =>
        Object.hasOwn(values, source) && values[source] !== undefined && values[source] !== null,
    )

    if (!isAvailable || compute === undefined) {
      continue
    }

    let computed: unknown

    try {
      computed = compute(values)
    } catch (error) {
      throw new NeodeError(
        `Failed to derive property "${key}" on model "${modelName}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error instanceof Error ? error : undefined },
      )
    }

    values[key] = computed

    result.recomputed.push(key)
  }

  return result
}

/**
Apply the schema's `in` transforms (NTS-449) onto the write payload,
mutating it in place: value -> stored form, before validation, so the
validation and the write observe the same stored value. Async transforms
are awaited. Transform failures surface the user's own error.
*/
export async function applyInTransforms(schema: EntitySchema, values: object): Promise<void> {
  if (!isRecord(values)) {
    return
  }

  for (const property of schema.getProperties()) {
    // Projected read-model values (counts, DTOs, computed) are never written
    if (isProjectedProperty(property)) {
      continue
    }

    const transform = property.getTransform()?.in

    if (transform === undefined) {
      continue
    }

    const key = property.getKey()

    if (!Object.hasOwn(values, key) || values[key] === undefined) {
      continue
    }

    values[key] = await transform(values[key])
  }
}

/**
CREATE (this:Label { ... }) RETURN elementId(this) AS __id

neode parity (WriteUtils.splitProperties in create mode): every property
value - defaults included - is inlined into the CREATE pattern, because
ON CREATE SET / ON MATCH SET are merge-only clauses.
*/
async function createNode(
  runner: Runner,
  schema: EntitySchema,
  model: object,
  depth = 0,
): Promise<string> {
  // NTS-597: nested targets (depth > 0) take the same write pipeline as the
  // root model BEFORE the properties are collected — the collection below
  // snapshots the model, so a compute-derived value landing on the model
  // afterwards never reaches the CREATE pattern. The root model was already
  // pipelined by MergeService.save; running it again there would re-apply
  // `in` transforms (and re-call embedding providers) on stored-form values.
  if (depth > 0) {
    await applyEmbeddings(schema, model)

    // compute-side values land on the model below; the cypherSets of this
    // result are recomputed after collection (an explicit value wins)
    deriveProperties(schema, model)

    await applyInTransforms(schema, model)

    // Fakes resolve per-property during collection (valueWithFake) — stamp
    // them first so validation observes the values the write will use
    applyFakeValues(schema, model)

    validate(modelPropertyValues(model, schema), schema)
  }

  const properties: Record<string, unknown> = {}

  const vectors: { key: string; value: unknown }[] = []

  for (const property of schema.getProperties()) {
    // Mapped / internal / projected properties are not writable
    if (
      property.getType() === PropertyType.INTERNAL_ID ||
      property.getType() === PropertyType.ALL_PROPERTIES ||
      property.getType() === PropertyType.NODE ||
      isProjectedProperty(property)
    ) {
      continue
    }

    const value = valueWithFake(model, property, schema)

    if (value === undefined || value === null) {
      continue
    }

    // Vector properties persist through the space-efficient vector
    // storage procedure (NTS-449), not the inline CREATE pattern
    if (property.getVector() === undefined) {
      properties[property.getKey()] = value
    } else {
      vectors.push({ key: property.getKey(), value })
    }
  }

  // Server-side timestamps (NTS-165): unstamped @CreatedAt / @UpdatedAt
  // properties render `datetime()` verbatim in the CREATE pattern
  stampCreateTimestamps(schema, properties)

  // Optimistic locking (NTS-158): a created node starts at version 0
  stampCreateVersion(schema, properties)

  const builder = new Builder()

  builder.create(THIS_NODE, schema.getLabels(), properties)

  for (const { key, value } of vectors) {
    builder.setVectorProperty(THIS_NODE, key, value)
  }

  // Cypher-side derived properties (NTS-569): evaluated by the database
  // against the node created above — its properties already carry the new
  // values. compute-side values were already folded into `properties` (an
  // explicit value wins on the second resolve, so compute runs once).
  for (const { key, cypher } of deriveProperties(schema, model).cypherSets) {
    builder.setExpr(`${THIS_NODE}.${quote(key)}`, cypher)
  }

  builder.return(THIS_NODE, `elementId(${THIS_NODE}) AS ${INTERNAL_ID}`)

  const { query, params } = builder.build()

  const result = await runner.run(query, params)

  const firstRecord = result.records[0]

  if (firstRecord === undefined) {
    throw new NeodeError(
      `CREATE statement for "${schema.getLabels().join(':')}" returned no records — ` +
        'check the statement in the query log (QUERY_EXECUTED event) for the database error',
    )
  }

  const internalId: unknown = firstRecord.get(INTERNAL_ID)

  if (typeof internalId !== 'string') {
    throw new NeodeError(
      `CREATE statement for "${schema.getLabels().join(':')}" did not return an ${INTERNAL_ID}`,
    )
  }

  return internalId
}

async function createRelationships(
  runner: Runner,
  thisId: string,
  schema: EntitySchema,
  model: object,
  depth: number,
): Promise<void> {
  // Depth cap: nodes nested deeper than MAX_CREATE_DEPTH are not created
  if (depth >= MAX_CREATE_DEPTH || !isRecord(model)) {
    return
  }

  await Promise.all(
    schema.getRelationships().map(async (relationship) => {
      const key = relationship.getKey()

      const propertyValue: unknown = model[key]

      // If property is not set (or falsy) then ignore it
      const hasValue = Object.hasOwn(model, key) && Boolean(propertyValue)

      if (!hasValue) {
        return
      }

      const value = propertyValue

      const values = relationship.getMany() && Array.isArray(value) ? value : [value]

      // Reject before creating anything: a one-cardinality relationship
      // cannot be seeded with two targets (NTS-161)
      assertCardinality(relationship, values.length)

      await Promise.all(
        values.map(async (target) => createTarget(runner, thisId, relationship, target, depth)),
      )
    }),
  )
}

async function createTarget(
  runner: Runner,
  thisId: string,
  relationship: RelationshipPropertySchema,
  value: unknown,
  depth: number,
): Promise<void> {
  // Reject before creating anything: BOTH is match-only (NTS-483)
  assertWritableDirection(relationship)

  const targetEntity = relationship.getTarget()

  const targetSchema = typeof targetEntity === 'function' ? getModel(targetEntity) : undefined

  if (!(targetSchema instanceof EntitySchema)) {
    throw new NeodeError(
      `Couldn't find a model for the target of relationship "${relationship.getKey()}" ` +
        `(configured target: "${
          typeof targetEntity === 'function' ? targetEntity.name : 'unknown'
        }") — register it with @NodeEntity or defineModel() first.`,
    )
  }

  if (!isRecord(value)) {
    throw new TypeError(
      `The value of relationship "${relationship.getKey()}" must be an object to create`,
    )
  }

  // Relationship entity target: create the node at the far end of the
  // relationship, then relate the two nodes with the entity's properties
  // (mirrors MergeService.save)
  if (targetSchema.getType() === EntityType.RelationshipEntity) {
    const otherProperty = getOtherProperty(relationship, targetSchema, targetEntity)

    const otherEntity = otherProperty.getEntity()

    if (otherEntity === undefined) {
      throw new NeodeError(
        'The relationship entity has no target entity — declare the target model with @NodeEntity or defineModel() first',
      )
    }

    const otherSchema = getModel(otherEntity)

    if (!(otherSchema instanceof EntitySchema)) {
      throw new NeodeError(
        `No schema registered for the relationship target "${otherEntity.name}" — register it with @NodeEntity or defineModel() first`,
      )
    }

    const otherModel: unknown = value[otherProperty.getKey()]

    if (!isRecord(otherModel)) {
      throw new TypeError(
        `The value of "${otherProperty.getKey()}" on the relationship entity must be an object`,
      )
    }

    const otherId = await createNodeAndRelationships(runner, otherSchema, otherModel, depth + 1)

    await relateNodes(runner, thisId, otherId, relationship, targetSchema, value)

    return
  }

  const targetId = await createNodeAndRelationships(runner, targetSchema, value, depth + 1)

  await relateNodes(runner, thisId, targetId, relationship, targetSchema, value)
}

/**
Relate two created nodes by element ID, setting any relationship entity
properties on the new relationship (mirrors MergeService#relateNodes)
*/
async function relateNodes(
  runner: Runner,
  fromId: string,
  toId: string,
  relationship: RelationshipPropertySchema,
  targetSchema: EntitySchema,
  entity: unknown,
): Promise<void> {
  assertWritableDirection(relationship)

  const from = 'from'
  const to = 'to'
  const relationshipAlias = 'rel'

  const builder = new Builder()

  builder
    .match(from)
    .whereId(from, fromId)
    .match(to)
    .whereId(to, toId)

    // Merge Relationship
    .merge(from)
    .relationship(relationship.getType(), relationship.getDirection(), relationshipAlias)
    .to(to)

  // Set relationship properties
  if (targetSchema.getType() === EntityType.RelationshipEntity && isRecord(entity)) {
    setRelationshipEntityProperties(builder, relationshipAlias, targetSchema, entity)
  }

  const { query, params } = builder.build()

  await runner.run(query, params)
}
