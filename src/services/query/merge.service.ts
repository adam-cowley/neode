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
import {
  applyEmbeddings,
  applyFakeValues,
  applyInTransforms,
  createNodeAndRelationships,
  getOtherProperty,
  modelPropertyValues,
  setRelationshipEntityProperties,
} from '../write-utilities.js'
import { validate } from '../../validation/index.js'
import { NeodeError } from '../../errors/index.js'
import { QueryService } from './query.service.js'
import { isRecord } from '../type-guards.js'

/**
Properties used for merge matching: unique OR indexed
(neode's Model.mergeFields)
*/
export function getMergeFields(schema: EntitySchema): PropertySchema[] {
  return schema.getProperties().filter((property) => property.isUnique() || property.isIndex())
}

export class MergeService extends QueryService {
  private async relateNodes(
    fromId: string,
    toId: string,
    relationship: RelationshipPropertySchema,
    targetSchema: EntitySchema,
    entity: unknown,
  ): Promise<unknown> {
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
    // itself is explicitly provided
    await applyEmbeddings(schema, set)

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

      builder.set(`${THIS_NODE}.${key}`, value)
    }

    builder.return(THIS_NODE, `elementId(${THIS_NODE}) AS ${INTERNAL_ID}`)

    const { query, params } = builder.build()

    return this.runner.run(query, params)
  }

  async save(
    model: object,
    schema: EntitySchema,
  ): Promise<{ elementId: string; created: boolean }> {
    if (!isRecord(model)) {
      throw new TypeError('save requires a model object')
    }

    // Resolve embedding sugar (NTS-449): a vector property declared with
    // `from` + `provider` computes its vector from the source property
    // being written, unless the vector itself is explicitly provided
    await applyEmbeddings(schema, model)

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

      const value = getValueOrDefault(model, property, schema)

      // If property is not set then ignore it
      if (value !== undefined) {
        setPropertyInBuilder(builder, THIS_NODE, property, value)
      }
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

    // Save relationship targets in the same transaction
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

        const values: unknown[] = relationship.getMany() && Array.isArray(value) ? value : [value]

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

              const saved = await this.save(otherModel, otherSchema)

              await this.relateNodes(thisId, saved.elementId, relationship, targetSchema, element)
            }),
          )
        }

        return Promise.all(
          values.map(async (element) => {
            if (!isRecord(element)) {
              throw new TypeError(`The value of relationship "${key}" must be an object to save`)
            }

            // Save Node
            const saved = await this.save(element, targetSchema)

            // Relate the two nodes together
            await this.relateNodes(thisId, saved.elementId, relationship, targetSchema, element)
          }),
        )
      }),
    )

    return { elementId: thisId, created: wasCreated }
  }
}
