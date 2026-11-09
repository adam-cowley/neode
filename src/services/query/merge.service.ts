import { Builder } from '../../query/index.js'
import { INTERNAL_ID, THIS_NODE } from '../../constants.js'
import type { QueryOutput } from '../../driver/types.js'
import { getModel } from '../../meta/index.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { EntityType } from '../../meta/entity/entity-schema.js'
import type { PropertySchema } from '../../meta/property-schema.js'
import { isProjectedProperty } from '../../meta/property-schema.js'
import type { RelationshipPropertySchema } from '../../meta/relationship-property-schema.js'
import { getValueOrDefault, getValuesAsRecord, setPropertyInBuilder } from '../../utilities.js'
import { elementIdOfEntity } from '../../element-id.js'
import {
  SERVER_TIMESTAMP,
  versionBump,
  applyEmbeddings,
  applyFakeValues,
  applyInTransforms,
  createNodeAndRelationships,
  deriveProperties,
  getOtherProperty,
  assertCardinality,
  assertWritableDirection,
  modelPropertyValues,
  setRelationshipEntityProperties,
  timestampProperty,
  versionProperty,
} from '../write-utilities.js'
import { quote } from '../../query/quote.js'
import { validate } from '../../validation/index.js'
import { NeodeError, OptimisticLockError } from '../../errors/index.js'
import { QueryService } from './query.service.js'
import { isRecord } from '../type-guards.js'

/**
Properties used for merge matching: unique OR indexed
(neode's Model.mergeFields)
*/
export function getMergeFields(schema: EntitySchema): PropertySchema[] {
  return schema.getProperties().filter((property) => property.isUnique() || property.isIndex())
}

/**
Options for MergeService.save
*/
export interface MergeSaveOptions {
  /**
  Optimistic locking (NTS-158): this save is a nested relationship-target
  write reached through another node's save — the target's @Version is
  neither checked nor bumped (SDN issue 2604 lesson: version never
  cascades across related nodes). A genuinely created target still starts
  at version 0.
  */
  nested?: boolean
}

/**
Server-side timestamps on a MERGE (NTS-165): `createdAt` stamps on create
only, `updatedAt` on create and on match. The expressions render after the
MERGE pattern and before the plain SET clauses, so an explicitly written
timestamp value in the same statement overrides the stamp.
*/
function stampMergeTimestamps(builder: Builder, schema: EntitySchema): void {
  for (const kind of ['createdAt', 'updatedAt'] as const) {
    const property = timestampProperty(schema, kind)

    if (property === undefined) {
      continue
    }

    const key = `${THIS_NODE}.${property.getKey()}`

    builder.onCreateSetExpr(key, SERVER_TIMESTAMP)

    if (kind === 'updatedAt') {
      builder.onMatchSetExpr(key, SERVER_TIMESTAMP)
    }
  }
}

/**
Optimistic locking on a MERGE (NTS-158): a created node starts at version
0. `bump` also increments on the match path — off when a guard statement
already checked-and-incremented the version, or when the save is a nested
relationship-target write (version never cascades).
*/
function stampMergeVersion(builder: Builder, schema: EntitySchema, shouldBump: boolean): void {
  const property = versionProperty(schema)

  if (property === undefined) {
    return
  }

  const key = `${THIS_NODE}.${property.getKey()}`

  builder.onCreateSetExpr(key, '0')

  if (shouldBump) {
    builder.onMatchSetExpr(key, versionBump(THIS_NODE, property.getKey()))
  }
}

export class MergeService extends QueryService {
  /**
  Optimistic-lock guard (NTS-158): when the model declares @Version and the
  instance carries the numeric version it was hydrated with, match the node
  by elementId AND its stored version, incrementing it in the same
  statement — the write lock the SET takes makes the check-and-increment
  atomic, so a concurrent guarded save serialises behind this one. Zero
  matched rows (version moved on, or the node is gone) throws
  OptimisticLockError. Returns whether the guard ran.
  */
  private async guardVersion(model: object, schema: EntitySchema): Promise<boolean> {
    const property = versionProperty(schema)

    if (property === undefined) {
      return false
    }

    const key = property.getKey()

    const expectedVersion: unknown = Reflect.get(model, key)

    if (typeof expectedVersion !== 'number') {
      return false
    }

    const elementId = elementIdOfEntity(schema, model)

    if (elementId === undefined) {
      return false
    }

    const builder = new Builder()

    builder
      .match(THIS_NODE)
      .whereId(THIS_NODE, elementId)
      .whereRaw(`${THIS_NODE}.${key} = $expectedVersion`)
      .setExpr(`${THIS_NODE}.${key}`, versionBump(THIS_NODE, key), { expectedVersion })
      .return(THIS_NODE, `elementId(${THIS_NODE}) AS ${INTERNAL_ID}`)

    const { query, params } = builder.build()

    const result = await this.runner.run(query, params)

    if (result.records.length === 0) {
      throw new OptimisticLockError(schema.getLabels().join(':'))
    }

    return true
  }

  private async relateNodes(
    fromId: string,
    toId: string,
    relationship: RelationshipPropertySchema,
    targetSchema: EntitySchema,
    entity: unknown,
  ): Promise<unknown> {
    assertWritableDirection(relationship)

    const fromNode = 'from'
    const toNode = 'to'
    const thisRelationship = 'rel'

    const builder = new Builder()

    // Match nodes by element ID, falling back to a merge if unknown
    builder
      .match(fromNode)
      .whereId(fromNode, fromId)
      .match(toNode)
      .whereId(toNode, toId)

      // Merge Relationship
      .merge(fromNode)
      .relationship(relationship.getType(), relationship.getDirection(), thisRelationship)
      .to(toNode)

    // Set relationship properties
    if (targetSchema.getType() === EntityType.RelationshipEntity && isRecord(entity)) {
      setRelationshipEntityProperties(builder, thisRelationship, targetSchema, entity)
    }

    const { query, params } = builder.build()

    return this.runner.run(query, params)
  }

  /**
  MERGE a node on the given match properties, then set the given properties
  */
  async mergeOn(
    schema: EntitySchema,
    match: Record<string, unknown>,
    set: Record<string, unknown> = {},
  ): Promise<QueryOutput> {
    // Skip undefined match values
    const matchRecord = Object.fromEntries(
      Object.entries(match).filter(([, value]) => value !== undefined),
    )

    if (Object.keys(matchRecord).length === 0) {
      throw new NeodeError('mergeOn requires at least one match property')
    }

    // Resolve embedding sugar (NTS-449) onto the set values first: a
    // vector property declared with `from` + `provider` computes its
    // vector from the source property being written, unless the vector
    // itself is explicitly provided. Stored derived properties (NTS-569)
    // resolve the same way — compute-side onto the set record, cypher-side
    // appended after the SET clause
    await applyEmbeddings(schema, set)

    const derived = deriveProperties(schema, set)

    // Apply `in` transforms (NTS-449): user value -> stored form, on
    // both the match and set values, before validation
    await applyInTransforms(schema, matchRecord)
    await applyInTransforms(schema, set)

    // Validate the combined match + set values before writing (neode
    // validates both), with the same defaults the set clause applies
    const written: Record<string, unknown> = { ...matchRecord }

    for (const property of schema.getProperties()) {
      if (Object.hasOwn(matchRecord, property.getKey()) || isProjectedProperty(property)) {
        continue
      }

      const value = getValueOrDefault(set, property, schema)

      if (value !== undefined) {
        written[property.getKey()] = value
      }
    }

    validate(written, schema)

    const builder = new Builder()

    builder.merge(THIS_NODE, schema.getLabels(), matchRecord)

    // Set Properties: explicit set values, falling back to schema
    // defaults (e.g. a UUID primary key on create). Unset values are
    // skipped rather than deleted.
    for (const property of schema.getProperties()) {
      const key = property.getKey()

      // Match properties are inline in the MERGE, not set; projected
      // read-model values are never written
      if (Object.hasOwn(matchRecord, key) || isProjectedProperty(property)) {
        continue
      }

      const value = getValueOrDefault(set, property, schema)

      if (value !== undefined) {
        setPropertyInBuilder(builder, THIS_NODE, property, value)
      }
    }

    // Extra keys not declared on the schema are plain property sets
    for (const [key, value] of Object.entries(set)) {
      if (
        value === undefined ||
        schema.getProperties().some((property) => property.getKey() === key)
      ) {
        continue
      }

      builder.set(`${THIS_NODE}.${quote(key)}`, value)
    }

    // Cypher-side derived properties (NTS-569): evaluated after the SET
    // clause, so the expressions read the new source values
    for (const { key, cypher } of derived.cypherSets) {
      builder.setExpr(`${THIS_NODE}.${quote(key)}`, cypher)
    }

    // Server-side timestamps (NTS-165): createdAt stamps on create,
    // updatedAt on every write — an explicitly provided match/set value
    // overrides the stamp in the same statement
    stampMergeTimestamps(builder, schema)

    // Optimistic locking (NTS-158): version starts at 0 on create and
    // bumps by 1 on every matched write. mergeOn carries no expected
    // version in its API, so it never guards — it only maintains the
    // counter (a guarded write throws OptimisticLockError on mismatch).
    stampMergeVersion(builder, schema, true)

    builder.return(THIS_NODE, `elementId(${THIS_NODE}) AS ${INTERNAL_ID}`)

    const { query, params } = builder.build()

    return this.runner.run(query, params)
  }

  async save(
    model: object,
    schema: EntitySchema,
    dirtyKeys?: ReadonlySet<string>,
    options: MergeSaveOptions = {},
  ): Promise<{ elementId: string; created: boolean }> {
    if (!isRecord(model)) {
      throw new TypeError('save requires a model object')
    }

    // Optimistic locking (NTS-158): a tracked instance carrying the version
    // it was hydrated with checks-and-increments it atomically before the
    // merge — zero matched rows means the node changed (or vanished) under
    // another transaction. Nested relationship-target writes never guard
    // or bump: version is per node only (SDN issue 2604 lesson).
    const isVersionGuarded =
      options.nested === true ? false : await this.guardVersion(model, schema)

    // Resolve embedding sugar (NTS-449): a vector property declared with
    // `from` + `provider` computes its vector from the source property
    // being written, unless the vector itself is explicitly provided.
    // Tracked saves (NTS-157) recompute only from a dirty source; the
    // recomputed keys join the write set — their stored value is stale
    // by definition, even though the instance itself did not change them
    const recomputedEmbeddings = await applyEmbeddings(schema, model, dirtyKeys)

    // Stored derived properties (NTS-569): compute-side values land on the
    // model (transforms and validation see them; the recomputed keys join
    // the write set), cypher-side sets are appended after the SET clause
    const derived = deriveProperties(schema, model, dirtyKeys)

    // Apply `in` transforms (NTS-449): user value -> stored form, before
    // validation, so validation and the write see the same value
    await applyInTransforms(schema, model)

    // Validate the model's own values (defaults resolved) before any write
    validate(modelPropertyValues(model, schema), schema)

    const builder = new Builder()

    // Primary Key?
    const primaryKeys = schema
      .getProperties()
      .filter(
        (property) =>
          property.isPrimaryKey() &&
          Object.hasOwn(model, property.getKey()) &&
          model[property.getKey()] !== undefined,
      )

    // Primary keys when set, otherwise the merge fields (unique or indexed)
    const mergeOn = getValuesAsRecord(
      model,
      primaryKeys.length > 0 ? primaryKeys : getMergeFields(schema),
      schema,
    )

    if (Object.keys(mergeOn).length === 0) {
      // Nothing to merge on: the entity carries no identity, so save() is
      // a CREATE. (A bare MERGE (this:Label) would match an arbitrary
      // existing node of the label and overwrite it.)
      applyFakeValues(schema, model)

      validate(modelPropertyValues(model, schema), schema)

      const elementId = await createNodeAndRelationships(this.runner, schema, model)

      return { elementId, created: true }
    }

    builder.merge(THIS_NODE, schema.getLabels(), mergeOn)

    // Set Properties
    for (const property of schema.getProperties()) {
      // Projected read-model values are never written
      if (isProjectedProperty(property)) {
        continue
      }

      // NTS-157: tracked instances write only their dirty keys — plus
      // vector and derived properties recomputed from a dirty source above
      if (
        dirtyKeys !== undefined &&
        !dirtyKeys.has(property.getKey()) &&
        !recomputedEmbeddings.includes(property.getKey()) &&
        !derived.recomputed.includes(property.getKey())
      ) {
        continue
      }

      const value = getValueOrDefault(model, property, schema)

      // If property is not set then ignore it
      if (value !== undefined) {
        setPropertyInBuilder(builder, THIS_NODE, property, value)
      }
    }

    // Cypher-side derived properties (NTS-569): evaluated by the database
    // after the sources are SET, so the expressions read the new values
    for (const { key, cypher } of derived.cypherSets) {
      builder.setExpr(`${THIS_NODE}.${quote(key)}`, cypher)
    }

    // Server-side timestamps (NTS-165): every real write stamps updatedAt
    // (and createdAt when the merge creates). A tracked clean instance
    // never reaches this point — the facade skips the write entirely.
    if (dirtyKeys === undefined || dirtyKeys.size > 0) {
      stampMergeTimestamps(builder, schema)
    }

    // Optimistic locking (NTS-158): version starts at 0 on create; the
    // match-path bump only applies when no guard statement already
    // incremented it and this is not a nested relationship-target write
    if (dirtyKeys === undefined || dirtyKeys.size > 0) {
      stampMergeVersion(builder, schema, !isVersionGuarded && options.nested !== true)
    }

    builder.return(THIS_NODE, `elementId(${THIS_NODE}) AS ${INTERNAL_ID}`)

    // Build Cypher
    const { query, params } = builder.build()

    // Run it!
    const result = await this.runner.run(query, params)

    // Was the merge a create or a match? The root statement's summary
    // counters say — the nested relationship writes below also create
    // nodes, so this must be read from the root merge, not at the end.
    // Neo4j names the counter nodesCreated, the Relate engine nodes_created.
    const counters = result.summary?.counters ?? {}

    const wasCreated = (counters['nodesCreated'] ?? counters['nodes_created'] ?? 0) > 0

    // Get element ID
    const firstRecord = result.records[0]

    if (firstRecord === undefined) {
      throw new NeodeError('relate statement returned no records')
    }

    const thisId: unknown = firstRecord.get(INTERNAL_ID)

    if (typeof thisId !== 'string') {
      throw new TypeError(`relate statement did not return an ${INTERNAL_ID}`)
    }

    // Save relationship targets in the same transaction. Tracked saves
    // (NTS-157) never walk the graph: relationship writes belong to the
    // explicit relate()/detach() paths.
    if (dirtyKeys !== undefined) {
      return { elementId: thisId, created: wasCreated }
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

        // Reject before saving any targets: BOTH is match-only (NTS-483)
        assertWritableDirection(relationship)

        const value = propertyValue

        const values: unknown[] = relationship.getMany() && Array.isArray(value) ? value : [value]

        // A one-cardinality relationship cannot be saved with two targets
        // (NTS-161). The values are the write's own edges — the explicit
        // relate() path additionally guards against edges already in the
        // database.
        assertCardinality(relationship, values.length)

        const targetEntity = relationship.getTarget()

        const targetSchema = getModel(targetEntity)

        if (targetSchema.getType() === EntityType.RelationshipEntity) {
          return Promise.all(
            values.map(async (element) => {
              if (!isRecord(element)) {
                throw new TypeError(`The value of relationship "${key}" must be an object to save`)
              }

              const otherProperty = getOtherProperty(relationship, targetSchema, targetEntity)

              const otherModel: unknown = element[otherProperty.getKey()]

              if (!isRecord(otherModel)) {
                throw new TypeError(
                  `The value of "${otherProperty.getKey()}" on the relationship entity must be an object`,
                )
              }

              // The node at the far end is saved with ITS OWN schema —
              // the relationship entity's schema only describes the
              // relationship between the two nodes
              const otherEntity = otherProperty.getEntity()

              if (otherEntity === undefined) {
                throw new NeodeError(
                  `The relationship entity has no target entity — declare the target model with @NodeEntity or defineModel() first`,
                )
              }

              const otherSchema = getModel(otherEntity)

              const saved = await this.save(otherModel, otherSchema, undefined, { nested: true })

              await this.relateNodes(thisId, saved.elementId, relationship, targetSchema, element)
            }),
          )
        }

        return Promise.all(
          values.map(async (element) => {
            if (!isRecord(element)) {
              throw new TypeError(`The value of relationship "${key}" must be an object to save`)
            }

            // Save Node — a nested relationship-target write: the target's
            // version is never guarded or bumped (NTS-158)
            const saved = await this.save(element, targetSchema, undefined, { nested: true })

            // Relate the two nodes together
            await this.relateNodes(thisId, saved.elementId, relationship, targetSchema, element)
          }),
        )
      }),
    )

    return { elementId: thisId, created: wasCreated }
  }
}
