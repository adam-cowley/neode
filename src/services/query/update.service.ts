import { Builder, type EntityMatchCriteria } from '../../query/index.js'
import { INTERNAL_ID, THIS_NODE } from '../../constants.js'
import { matchCriteriaForEntity } from '../../utilities.js'
import type { GraphNode, QueryOutput } from '../../driver/types.js'
import { PropertyType, isProjectedProperty } from '../../meta/property-schema.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { validate } from '../../validation/index.js'
import { QueryService } from './query.service.js'
import { isGraphNode } from '../type-guards.js'
import { applyEmbeddings, applyInTransforms } from '../write-utilities.js'

/**
Property types that reference entities or internals — never plain values
*/
const NON_VALUE_TYPES = new Set<PropertyType>([
  PropertyType.INTERNAL_ID,
  PropertyType.ALL_PROPERTIES,
  PropertyType.ONE_TO_ONE,
  PropertyType.ONE_TO_MANY,
  PropertyType.START_NODE,
  PropertyType.END_NODE,
  PropertyType.OTHER_NODE,
  PropertyType.NODE,
  PropertyType.RELATIONSHIP,
])

export class UpdateService extends QueryService {
  /**
  Read the node's current properties (required-property refill source)
  */
  private async readNode(
    schema: EntitySchema,
    criteria: EntityMatchCriteria,
  ): Promise<GraphNode | undefined> {
    const builder = new Builder()

    builder.matchEntity(THIS_NODE, schema, criteria)

    builder.return(THIS_NODE)

    const { query, params } = builder.build()

    const result = await this.runner.run(query, params)

    const node = result.records[0]?.get(THIS_NODE)

    return isGraphNode(node) ? node : undefined
  }

  /**
  Update a node's properties, matched by the entity's primary key value.

  `+=` semantics: only the provided keys are written. Primary key,
  protected, readonly and hidden properties are never overwritten, and
  neither are relationship / node / internal-id properties. Keys not
  declared in the schema are ignored (create / merge parity). Required
  properties that would end up unset keep their current stored value
  (matching neode's Node#update, which re-reads required properties).
  */
  async update(
    schema: EntitySchema,
    entity: object,
    properties: Record<string, unknown>,
  ): Promise<QueryOutput> {
    const identityCriteria = matchCriteriaForEntity(schema, entity)

    // Resolve embedding sugar (NTS-449) and `in` transforms (NTS-449) on
    // the provided values first: user value -> stored form, before the
    // guards and validation. The required-property refill below re-reads
    // stored values, which are never transformed again.
    const provided = { ...properties }

    await applyEmbeddings(schema, provided)
    await applyInTransforms(schema, provided)

    // Properties an update must never overwrite
    const guarded = new Set(
      schema
        .getProperties()
        .filter(
          (property) =>
            property.isPrimaryKey() ||
            property.isProtected() ||
            property.isHidden() ||
            property.isReadonly() ||
            isProjectedProperty(property) ||
            NON_VALUE_TYPES.has(property.getType()),
        )
        .map((property) => property.getKey()),
    )

    for (const relationship of schema.getRelationships()) {
      guarded.add(relationship.getKey())
    }

    // Provided keys only (`+=`); undefined means "not provided", null unsets.
    // Iterating the schema (merge parity) ignores undeclared keys
    const set: Record<string, unknown> = {}

    for (const property of schema.getProperties()) {
      const key = property.getKey()
      const value = provided[key]

      if (value === undefined || guarded.has(key)) {
        continue
      }

      set[key] = value
    }

    // Required refill: a required property that would end up unset keeps
    // its current stored value
    const refill = schema.getProperties().filter((property) => {
      if (!property.isRequired()) {
        return false
      }

      const value = set[property.getKey()]

      return value === undefined || value === null
    })

    if (refill.length > 0) {
      const node = await this.readNode(schema, identityCriteria)

      for (const property of refill) {
        const stored = node?.properties[property.getKey()]

        if (stored !== undefined && stored !== null) {
          set[property.getKey()] = stored
        }
      }
    }

    // Nothing left to write
    if (Object.keys(set).length === 0) {
      return { records: [] }
    }

    // Validate the values about to be written (post-refill)
    validate(set, schema)

    // Vector properties are split out of the `+=` map and persisted
    // through the space-efficient vector storage procedure (NTS-449)
    const vectorProperties = schema
      .getProperties()
      .filter(
        (property) => property.getVector() !== undefined && set[property.getKey()] !== undefined,
      )

    const plain = Object.fromEntries(
      Object.entries(set).filter(([key]) =>
        vectorProperties.every((property) => property.getKey() !== key),
      ),
    )

    const builder = new Builder()

    builder.matchEntity(THIS_NODE, schema, identityCriteria)

    if (Object.keys(plain).length > 0) {
      builder.set(THIS_NODE, plain, '+=')
    }

    for (const property of vectorProperties) {
      builder.setVectorProperty(THIS_NODE, property.getKey(), set[property.getKey()])
    }

    builder.return(THIS_NODE, `elementId(${THIS_NODE}) AS ${INTERNAL_ID}`)

    const { query, params } = builder.build()

    return this.runner.run(query, params)
  }
}
