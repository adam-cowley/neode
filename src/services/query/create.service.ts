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

export class CreateService extends QueryService {
  /**
  CREATE a node for the given schema and model, recursively creating and
  relating any nested relationship targets
  */
  async create(schema: EntitySchema, model: object): Promise<{ elementId: string }> {
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

    const elementId = await createNodeAndRelationships(this.runner, schema, model)

    return { elementId }
  }
}
