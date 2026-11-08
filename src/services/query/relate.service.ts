import { Builder } from '../../query/index.js'
import { quote } from '../../query/quote.js'
import type { GraphRelationship } from '../../driver/types.js'
import { getModel } from '../../meta/index.js'
import { EntitySchema, EntityType } from '../../meta/entity/entity-schema.js'
import type { Newable } from '../../meta/newable.js'
import { PropertyType } from '../../meta/property-schema.js'
import { validate } from '../../validation/index.js'
import type { RelationshipPropertySchema } from '../../meta/relationship-property-schema.js'
import { convertPropertyValue, matchCriteriaForEntity } from '../../utilities.js'
import { QueryService } from './query.service.js'
import { NeodeError } from '../../errors/index.js'
import { constructorOf, isGraphRelationship } from '../type-guards.js'

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
The schema to match the related node by: the target entity's own model,
falling back to the model declared on the relationship
*/
function requireTargetSchema(
  toEntity: object,
  relationship: RelationshipPropertySchema,
): EntitySchema {
  const toConstructor: Newable | undefined = constructorOf(toEntity)

  const relationshipTarget = relationship.getTarget()

  const targetSchema =
    (typeof toConstructor === 'function' ? getModel(toConstructor) : undefined) ??
    (typeof relationshipTarget === 'function' ? getModel(relationshipTarget) : undefined)

  if (!(targetSchema instanceof EntitySchema)) {
    // NTS-446: name the relationship, its configured target, what was
    // received, and the fix
    const configuredTarget =
      typeof relationshipTarget === 'function' ? relationshipTarget.name : 'unknown'
    const received = typeof toConstructor === 'function' ? toConstructor.name : typeof toEntity

    throw new NeodeError(
      `Couldn't find a model for the target of relationship "${relationship.getKey()}" ` +
        `(configured target: "${configuredTarget}") — received "${received}". ` +
        'Register the target model with @NodeEntity or defineModel() first.',
    )
  }

  return targetSchema
}

export class RelateService extends QueryService {
  /**
  Set relationship properties. When the relationship's target is a
  relationship entity, values are converted through that entity's property
  schemas and internal node/relationship references are skipped.
  */
  private setProperties(
    builder: Builder,
    relationship: RelationshipPropertySchema,
    relationshipAlias: string,
    properties: Record<string, unknown>,
  ): void {
    const targetConstructor = relationship.getTarget()

    const relationshipTargetSchema =
      typeof targetConstructor === 'function' ? getModel(targetConstructor) : undefined

    for (const [key, value] of Object.entries(properties)) {
      if (value === undefined) {
        continue
      }

      if (
        relationshipTargetSchema instanceof EntitySchema &&
        relationshipTargetSchema.getType() === EntityType.RelationshipEntity
      ) {
        const property = relationshipTargetSchema
          .getProperties()
          .find((candidate) => candidate.getKey() === key)

        if (property !== undefined && INTERNAL_PROPERTY_TYPES.has(property.getType())) {
          continue
        }

        builder.set(
          `${relationshipAlias}.${quote(key)}`,
          property === undefined ? value : convertPropertyValue(value, property),
        )

        continue
      }

      builder.set(`${relationshipAlias}.${quote(key)}`, value)
    }
  }

  /**
  Relate two saved nodes, matching both by primary key and then MERGEing
  the relationship (CREATE with `forceCreate`, neode RelateTo.js parity).

  With an INCOMING direction the relationship is stored from the target
  to the source node (neode's DIRECTION_IN swap).

  When the relationship's target is a relationship entity, the given
  properties are converted through the relationship entity's property
  schemas.

  @returns the created/matched relationship, or undefined when either
           node could not be matched
  */
  async relate(
    schema: EntitySchema,
    fromEntity: object,
    toEntity: object,
    relationship: RelationshipPropertySchema,
    properties: Record<string, unknown> = {},
    isForceCreate = false,
  ): Promise<GraphRelationship | undefined> {
    const targetSchema = requireTargetSchema(toEntity, relationship)

    // Edge-entity properties are writes like any other: convert to the
    // stored form, then validate THAT (node-write order: conversion first,
    // rules on stored values — NTS-509). The edge schema is the
    // relationship's DECLARED target; the to-node is the far endpoint.
    const edgeTarget = relationship.getTarget()
    const edgeSchema = typeof edgeTarget === 'function' ? getModel(edgeTarget) : undefined

    if (
      edgeSchema instanceof EntitySchema &&
      edgeSchema.getType() === EntityType.RelationshipEntity
    ) {
      const converted: Record<string, unknown> = {}

      for (const [key, value] of Object.entries(properties)) {
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
    }

    const fromAlias = 'from'
    const toAlias = 'to'
    const relationshipAlias = 'rel'

    const fromMatch = matchCriteriaForEntity(schema, fromEntity)

    const toMatch = matchCriteriaForEntity(targetSchema, toEntity)

    const builder = new Builder()

    builder.matchEntity(fromAlias, schema, fromMatch)
    builder.matchEntity(toAlias, targetSchema, toMatch)

    if (isForceCreate) {
      builder
        .create(fromAlias)
        .relationship(relationship.getType(), relationship.getDirection(), relationshipAlias)
        .to(toAlias)
    } else {
      builder
        .merge(fromAlias)
        .relationship(relationship.getType(), relationship.getDirection(), relationshipAlias)
        .to(toAlias)
    }

    this.setProperties(builder, relationship, relationshipAlias, properties)

    builder.return(relationshipAlias)

    const { query, params } = builder.build()

    const result = await this.runner.run(query, params)

    const related: unknown = result.records[0]?.get(relationshipAlias)

    return isGraphRelationship(related) ? related : undefined
  }
}
