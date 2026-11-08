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
  Hard-delete even on a @SoftDelete model (NTS-510): DETACH DELETE the
  node instead of stamping the soft-delete label
  */
  force?: boolean

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
  Carry-over state while one delete() statement is being built: the node
  aliases bound so far and whether the previous clause was a DELETE.
  Cypher requires `WITH` between DELETE and the next MATCH — the carried
  aliases keep every still-referenced binding in scope (42N24).
  */
  private buildContext = { bound: [THIS_NODE] as string[], deleted: false }

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

    // A sibling cascade segment deleted before this MATCH — carry the
    // bindings over (this frame's patterns and the pending deletes of
    // enclosing frames reference them)
    if (this.buildContext.deleted) {
      builder.with(...this.buildContext.bound)
    }

    builder
      .optionalMatch(fromAlias)
      .relationship(relationship.getType(), relationship.getDirection(), relationshipAlias)
      .to(nodeAlias, targetSchema instanceof EntitySchema ? targetSchema.getLabels() : false)

    this.buildContext.bound.push(nodeAlias)
    this.buildContext.deleted = false

    if (targetSchema instanceof EntitySchema) {
      for (const targetRelationship of targetSchema.getRelationships()) {
        this.addCascadeDelete(builder, nodeAlias, targetRelationship, depth + 1, maxDepth)
      }
    }

    builder.detachDelete(nodeAlias)
    this.buildContext.deleted = true
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

    // Reset the per-query build state: service instances are reused
    this.buildContext = { bound: [THIS_NODE], deleted: false }

    // Match by the entity's identity: elementId when known, else the
    // primary key — with a clear error when neither is available
    // (matchCriteriaForEntity's "Did you save it first?")
    const criteria = matchCriteriaForEntity(schema, entity)

    builder.matchEntity(THIS_NODE, schema, criteria)

    // Declarative soft delete (NTS-510): SET the label + stamp instead of
    // deleting the node, unless the caller forces a hard delete
    const soft = schema.getSoftDelete()

    if (soft !== undefined && options?.force !== true) {
      builder
        .set(`${THIS_NODE}:${quote(soft.label)}`, undefined)
        .setExpr(`${THIS_NODE}.\`deletedAt\``, 'datetime()')

      const { query, params } = builder.build()

      await this.runner.run(query, params)

      return
    }

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
      for (const [index, relationship] of schema.getRelationships().entries()) {
        // A previous segment deleted its relationships — carry `this` over
        if (index > 0) {
          builder.with(...this.buildContext.bound)
        }

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
