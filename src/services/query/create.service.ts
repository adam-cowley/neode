import type { QueryOutput } from '../../driver/types.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import {
  applyEmbeddings,
  applyFakeValues,
  applyInTransforms,
  createNodeAndRelationships,
  deriveProperties,
  modelPropertyValues,
} from '../write-utilities.js'
import { validate } from '../../validation/index.js'
import { QueryService } from './query.service.js'

/**
Eager relationship creation on the write path (NTS-615): `relate` maps a
relationship KEY (or type) on the written model to the saved target entity
— or array of targets — to relate it to, inside the same managed
transaction as the write. Edges are MERGE-based, so a retried write stays
idempotent (the same guarantee relate() gives).
*/
export interface CreateOptions {
  relate?: Record<string, object | object[]>

  /**
  Edge properties per declared relationship key (NTS-628): relationship
  key -> literal property map, validated against the relationship's
  declared `properties` schema. Relationship VALUES stay entity instances
  or primary-key values on the property map itself; primary-key values are
  related in the root CREATE statement (NTS-627). Literal values only —
  expression-valued edge properties are a follow-up (will reuse the
  NTS-629 scalar-expression helper).
  */
  relationshipProperties?: Record<string, Record<string, unknown>>
}

export class CreateService extends QueryService {
  /**
  CREATE a node for the given schema and model, recursively creating and
  relating any nested relationship targets. `edgeProperties` (NTS-628) is
  the composed-write carrier — relationship key -> literal edge
  properties, validated against the relationship's declared `properties`
  schema and rendered onto the edges.
  */
  async create(
    schema: EntitySchema,
    model: object,
    edgeProperties: Record<string, Record<string, unknown>> = {},
  ): Promise<{ elementId: string; output: QueryOutput }> {
    // Resolve the schema's `fake` generators onto the model first
    // (NTS-444): fake runs before validation, after explicit values and
    // defaults, so validation and the write see the same value
    applyFakeValues(schema, model)

    // Resolve embedding sugar (NTS-449): a vector property declared with
    // `from` + `provider` computes its vector from the source property
    // being written, unless the vector itself is explicitly provided
    await applyEmbeddings(schema, model)

    // Resolve stored derived properties (NTS-569): compute-side values are
    // written onto the model here so transforms and validation see them;
    // cypher-side sets are appended to the statement inside createNode
    deriveProperties(schema, model)

    // Apply `in` transforms (NTS-449): user value -> stored form, before
    // validation, so validation and the write see the same value
    await applyInTransforms(schema, model)

    // Validate the model's values (defaults resolved, neode parity) before any write
    validate(modelPropertyValues(model, schema), schema)

    return createNodeAndRelationships(this.runner, schema, model, 0, edgeProperties)
  }
}
