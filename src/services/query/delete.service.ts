import { Builder } from '../../query/index.js'
import { quote } from '../../query/quote.js'
import { THIS_NODE } from '../../constants.js'
import { matchCriteriaForEntity } from '../../utilities.js'
import { getModel } from '../../meta/index.js'
import { EntitySchema } from '../../meta/entity/entity-schema.js'
import type { EntitySchema as EntitySchemaType } from '../../meta/entity/entity-schema.js'
import type { RelationshipPropertySchema } from '../../meta/relationship-property-schema.js'
import { QueryService } from './query.service.js'
import { isRecord } from '../type-guards.js'

/**
Maximum cascade deletion depth (neode DeleteNode.js parity)
*/
export const MAX_CASCADE_DEPTH = 10

export interface DeleteOptions {
  /**
  Cascade into the related entities declared on the schema
  */
  cascade?: boolean

  /**
  'delete' (default) deletes related nodes recursively;
  'detach' removes only the relationships, keeping the related nodes
  */
  mode?: 'delete' | 'detach'

  /**
  Maximum cascade depth, defaults to {@link MAX_CASCADE_DEPTH}
  */
  depth?: number

  /**
  Soft delete: SET this label on the node instead of deleting it
  (labels-as-state lifecycle). Cascade options are ignored.
  */
  soft?: string
}

export class DeleteService extends QueryService {
  /**
  Add an optional match of a related node plus its own cascades, then
  delete it. `depth` is the number of relationship hops from the root.
  */
  private addCascadeDelete(
    builder: Builder,
    fromAlias: string,
    relationship: RelationshipPropertySchema,
    depth: number,
    maxDepth: number,
  ): void {
    if (depth > maxDepth) {
      return
    }

    const relationshipAlias = `${fromAlias}_${relationship.getKey()}_rel`
    const nodeAlias = `${fromAlias}_${relationship.getKey()}_node`

    const target = relationship.getTarget()

    const targetSchema = typeof target === 'function' ? getModel(target) : undefined

    builder
      .optionalMatch(fromAlias)
      .relationship(relationship.getType(), relationship.getDirection(), relationshipAlias)
      .to(nodeAlias, targetSchema instanceof EntitySchema ? targetSchema.getLabels() : false)

    if (targetSchema instanceof EntitySchema) {
      for (const targetRelationship of targetSchema.getRelationships()) {
        this.addCascadeDelete(builder, nodeAlias, targetRelationship, depth + 1, maxDepth)
      }
    }

    builder.detachDelete(nodeAlias)
  }

  /**
  Delete a node. Without options this is a plain DETACH DELETE.

  Note: RelationshipPropertySchema has no per-relationship cascade flag,
  so when cascading, every relationship declared on the schema cascades
  (neode keys this off relationship.cascade()).
  */
  async delete(schema: EntitySchemaType, entity: object, options?: DeleteOptions): Promise<void> {
    if (!isRecord(entity)) {
      throw new TypeError('delete requires an entity object')
    }

    const builder = new Builder()

    // Match by the entity's identity: elementId when known, else the
    // primary key — with a clear error when neither is available
    // (matchCriteriaForEntity's "Did you save it first?")
    const criteria = matchCriteriaForEntity(schema, entity)

    builder.matchEntity(THIS_NODE, schema, criteria)

    // Soft delete: SET the label instead of deleting the node
    const softLabel = options?.soft

    if (softLabel !== undefined && softLabel !== '') {
      builder.set(`${THIS_NODE}:${quote(softLabel)}`, undefined)

      const { query, params } = builder.build()

      await this.runner.run(query, params)

      return
    }

    const isCascade = options?.cascade === true || options?.mode !== undefined

    if (isCascade && options.mode === 'detach') {
      // Delete the relationships to related nodes first, then the node
      // itself: related nodes survive (neode DeleteNode.js addDetachNode)
      for (const relationship of schema.getRelationships()) {
        const relationshipAlias = `${THIS_NODE}_${relationship.getKey()}_rel`

        builder
          .optionalMatch(THIS_NODE)
          .relationship(relationship.getType(), relationship.getDirection(), relationshipAlias)
          .toAnything()
          .delete(relationshipAlias)
      }

      builder.detachDelete(THIS_NODE)
    } else if (isCascade) {
      // Recursively match and delete related nodes, bounded by depth
      // (neode DeleteNode.js addCascadeDeleteNode)
      for (const relationship of schema.getRelationships()) {
        this.addCascadeDelete(
          builder,
          THIS_NODE,
          relationship,
          1,
          options.depth ?? MAX_CASCADE_DEPTH,
        )
      }

      builder.detachDelete(THIS_NODE)
    } else {
      builder.detachDelete(THIS_NODE)
    }

    const { query, params } = builder.build()

    await this.runner.run(query, params)
  }
}
