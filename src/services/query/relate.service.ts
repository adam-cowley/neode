import { Builder } from '../../query/index.js'
import { quote } from '../../query/quote.js'
import type { GraphRelationship } from '../../driver/types.js'
import { getModel } from '../../meta/index.js'
import { EntitySchema, EntityType } from '../../meta/entity/entity-schema.js'
import type { Newable } from '../../meta/newable.js'
import type { RelationshipPropertySchema } from '../../meta/relationship-property-schema.js'
import { convertPropertyValue, matchCriteriaForEntity } from '../../utilities.js'
import { QueryService } from './query.service.js'
import { NeodeError } from '../../errors/index.js'
import { assertCardinality, assertWritableDirection } from '../write-utilities.js'
import { convertEdgeProperties, INTERNAL_PROPERTY_TYPES } from '../relationship-values.js'
import { constructorOf, isGraphRelationship } from '../type-guards.js'

/**
The cardinality guard's aliases (NTS-161): the other-end node and the
count column, kept out of the user-visible alias space
*/
const OTHER_ALIAS = 'other_end'
const EXISTING_EDGES = 'existing_edges'

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
  schemas and internal node/relationship references are skipped. With
  `isUpsert` (NTS-628) the properties render as ON CREATE SET + ON MATCH
  SET — applied whether the MERGE creates the edge or matches it —
  instead of a plain SET.
  */
  private setProperties(
    builder: Builder,
    relationship: RelationshipPropertySchema,
    relationshipAlias: string,
    properties: Record<string, unknown>,
    isUpsert = false,
  ): void {
    const targetConstructor = relationship.getTarget()

    const relationshipTargetSchema =
      typeof targetConstructor === 'function' ? getModel(targetConstructor) : undefined

    for (const [key, value] of Object.entries(properties)) {
      if (value === undefined) {
        continue
      }

      const rendered = `${relationshipAlias}.${quote(key)}`

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

        const converted = property === undefined ? value : convertPropertyValue(value, property)

        if (isUpsert) {
          builder.onCreateSet(rendered, converted)
          builder.onMatchSet(rendered, converted)
        } else {
          builder.set(rendered, converted)
        }

        continue
      }

      if (isUpsert) {
        builder.onCreateSet(rendered, value)
        builder.onMatchSet(rendered, value)
      } else {
        builder.set(rendered, value)
      }
    }
  }

  /**
  Edge-entity properties are writes like any other (NTS-509). The
  conversion + validation itself lives in convertEdgeProperties
  (relationship-values.ts) so the bulk paths share it.
  */
  private assertEdgeProperties(
    relationship: RelationshipPropertySchema,
    properties: Record<string, unknown>,
  ): void {
    convertEdgeProperties(relationship, properties)
  }

  /**
  Relate two saved nodes, matching both by primary key and then MERGEing
  the relationship (CREATE with `forceCreate`, neode RelateTo.js parity).

  With an INCOMING direction the relationship is stored from the target
  to the source node (neode's DIRECTION_IN swap).

  When the relationship's target is a relationship entity, the given
  properties are converted through the relationship entity's property
  schemas.

  `fromId` (NTS-615) matches the from-node by elementId instead of the
  entity's identity — the create path relates a node it just created,
  before hydration.

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
    fromId?: string,
  ): Promise<GraphRelationship | undefined> {
    assertWritableDirection(relationship)

    const targetSchema = requireTargetSchema(toEntity, relationship)

    // Edge-entity properties are writes like any other: convert to the
    // stored form, then validate THAT (node-write order: conversion first,
    // rules on stored values — NTS-509). The edge schema is the
    // relationship's DECLARED target; the to-node is the far endpoint.
    this.assertEdgeProperties(relationship, properties)

    const fromAlias = 'from'
    const toAlias = 'to'
    const relationshipAlias = 'rel'

    // NTS-615 (eager relates on create): the from-node may exist only as a
    // just-created elementId — the created instance is not hydrated yet
    const fromMatch =
      fromId === undefined
        ? matchCriteriaForEntity(schema, fromEntity)
        : { elementId: fromId, key: schema.getPrimaryKey()?.getKey() ?? '', value: undefined }

    const toMatch = matchCriteriaForEntity(targetSchema, toEntity)

    // Cardinality guard (NTS-161) BEFORE any write: count the edges the
    // from-node already holds on this relationship. A MERGE re-relating
    // the same target is idempotent (those edges are excluded), a
    // forceCreate duplicate counts too. Restricted cardinalities only —
    // `many` never pays for the read.
    //
    // Known race (NTS-579): this is check-then-write across two
    // statements, so two concurrent relate() calls can each see zero
    // edges and both create one, exceeding a `one` / `zeroOrOne`
    // cardinality. Cardinality is an application-level guard, not a
    // database constraint; serialise writers when it must hold under
    // concurrency.
    if (relationship.getCardinality() !== 'many') {
      const guard = new Builder()

      guard.matchEntity(fromAlias, schema, fromMatch)

      if (!isForceCreate) {
        guard.matchEntity(toAlias, targetSchema, toMatch)
      }

      guard
        .match(fromAlias)
        .relationship(relationship.getType(), relationship.getDirection(), relationshipAlias)
        .to(OTHER_ALIAS)

      if (!isForceCreate) {
        // elementId comparison rather than node `<>`: plain scalar
        // inequality, safe on every Cypher-compatible backend
        guard.whereRaw(`elementId(${OTHER_ALIAS}) <> elementId(${toAlias})`)
      }

      guard.return(`count(${relationshipAlias}) AS ${EXISTING_EDGES}`)

      const guardQuery = guard.build()

      const guardResult = await this.runner.run(guardQuery.query, guardQuery.params)

      const existingEdges: unknown = guardResult.records[0]?.get(EXISTING_EDGES) ?? 0

      assertCardinality(relationship, Number(existingEdges) + 1)
    }

    const builder = new Builder()

    builder.matchEntity(fromAlias, schema, fromMatch)
    builder.matchEntity(toAlias, targetSchema, toMatch)

    if (isForceCreate) {
      builder
        .create(fromAlias)
        .relationship(relationship.getType(), relationship.getDirection(), relationshipAlias)
        .to(toAlias)

      this.setProperties(builder, relationship, relationshipAlias, properties)
    } else {
      builder
        .merge(fromAlias)
        .relationship(relationship.getType(), relationship.getDirection(), relationshipAlias)
        .to(toAlias)

      // NTS-628: MERGE upserts the edge properties — applied whether the
      // MERGE created the edge or matched it (ON CREATE SET / ON MATCH SET)
      this.setProperties(builder, relationship, relationshipAlias, properties, true)
    }

    builder.return(relationshipAlias)

    const { query, params } = builder.build()

    const result = await this.runner.run(query, params)

    const related: unknown = result.records[0]?.get(relationshipAlias)

    return isGraphRelationship(related) ? related : undefined
  }

  /**
  Set the properties of ONE declared relationship's edge (NTS-628): match
  both nodes by identity, MERGE the edge (never duplicating it — re-runs
  are idempotent) and SET the properties. Validates against the
  relationship's declared edge-property schema.
  */
  async updateEdgeProperties(
    schema: EntitySchema,
    fromEntity: object,
    relationship: RelationshipPropertySchema,
    toEntity: object,
    properties: Record<string, unknown> = {},
  ): Promise<GraphRelationship | undefined> {
    assertWritableDirection(relationship)

    this.assertEdgeProperties(relationship, properties)

    const targetSchema = requireTargetSchema(toEntity, relationship)

    const fromAlias = 'from'
    const toAlias = 'to'
    const relationshipAlias = 'rel'

    const builder = new Builder()

    builder.matchEntity(fromAlias, schema, matchCriteriaForEntity(schema, fromEntity))
    builder.matchEntity(toAlias, targetSchema, matchCriteriaForEntity(targetSchema, toEntity))

    builder
      .merge(fromAlias)
      .relationship(relationship.getType(), relationship.getDirection(), relationshipAlias)
      .to(toAlias)

    this.setProperties(builder, relationship, relationshipAlias, properties)

    builder.return(relationshipAlias)

    const { query, params } = builder.build()

    const result = await this.runner.run(query, params)

    const related: unknown = result.records[0]?.get(relationshipAlias)

    return isGraphRelationship(related) ? related : undefined
  }
}
