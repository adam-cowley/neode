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
import { NeodeError } from '../../errors/neode-error.js'
import {
  SERVER_TIMESTAMP,
  timestampProperty,
  versionBump,
  versionProperty,
} from '../write-utilities.js'

/**
Maximum depth of the self-referential cascade walk — the delete-path
counterpart of MAX_TRAVERSE_DEPTH (traverse) and MAX_CREATE_DEPTH
(services/write-utilities). Overridable per call with the `depth` option
of {@link DeleteOptions} (NTS-595).
*/
export const MAX_CASCADE_DEPTH = 10

/**
Guard for the bulk deleteAll paths (NTS-595, following the NTS-578
destructive-guards precedent): a call with no filters deletes EVERY node
carrying the model's labels, so it is refused unless confirmed with
`all: true` — a filtered call proceeds as the fast bulk wipe.
*/
export function assertDeleteAllScope(parameters: Record<string, unknown>, labels: string[]): void {
  const filters = Object.keys(parameters).filter((key) => key !== 'all')

  if (filters.length === 0 && parameters['all'] !== true) {
    throw new NeodeError(
      `deleteAll() refused on ${labels.join(':') || 'model'} — with no filters it deletes ` +
        'every node carrying the model’s labels, including nodes your filters would ' +
        'have hidden. Pass at least one filter to delete a subset, or { all: true } to ' +
        'confirm the wipe.',
    )
  }
}

export interface DeleteOptions {
  /**
  Cascade into the related entities declared on the schema: true cascades
  every relationship, false none, undefined follows each relationship's
  own `cascade` annotation
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
  Carry-over state while one delete() statement is being built: whether
  the previous clause was a DELETE. Cypher requires `WITH` between DELETE
  and the next MATCH — each new cascade frame re-states only the alias
  chain its remaining clauses reference, with DISTINCT so the rows
  sibling frames already fanned out do not cross-multiply (NTS-595).
  */
  private buildContext = { deleted: false }

  /**
  Add an optional match of a related node plus its own cascades, then
  delete it. `depth` is the number of relationship hops from the root.
  `selection` decides which relationships cascade: 'all' ignores the
  annotations, 'annotated' follows only `cascade: true` declarations.
  `scope` is the alias chain from the root to `fromAlias` — exactly the
  bindings the remaining frames still reference.
  */
  private addCascadeDelete(
    builder: Builder,
    fromAlias: string,
    relationship: RelationshipPropertySchema,
    depth: number,
    maxDepth: number,
    selection: 'all' | 'annotated',
    scope: string[],
  ): void {
    if (depth > maxDepth) {
      return
    }

    if (selection === 'annotated' && !relationship.getCascade()) {
      return
    }

    const relationshipAlias = `${fromAlias}_${relationship.getKey()}_rel`
    const nodeAlias = `${fromAlias}_${relationship.getKey()}_node`

    const target = relationship.getTarget()

    const targetSchema = typeof target === 'function' ? getModel(target) : undefined

    // The previous frame deleted its matches — re-state this frame's
    // alias chain (DISTINCT collapses the rows the previous frame fanned
    // out, so sibling subtrees never cross-multiply)
    if (this.buildContext.deleted) {
      builder.withDistinct(...scope)
    }

    builder
      .optionalMatch(fromAlias)
      .relationship(relationship.getType(), relationship.getDirection(), relationshipAlias)
      .to(nodeAlias, targetSchema instanceof EntitySchema ? targetSchema.getLabels() : false)

    if (targetSchema instanceof EntitySchema) {
      for (const targetRelationship of targetSchema.getRelationships()) {
        this.addCascadeDelete(
          builder,
          nodeAlias,
          targetRelationship,
          depth + 1,
          maxDepth,
          selection,
          [...scope, nodeAlias],
        )
      }
    }

    builder.detachDelete(nodeAlias)
    this.buildContext.deleted = true
  }

  /**
  Delete a node. Without options, relationships annotated `cascade: true`
  cascade (recursively, each level applying its own annotations);
  relationships without the annotation survive. `{ cascade: true }`
  cascades every relationship declared on the schema; `{ cascade: false }`
  cascades none.
  */
  async delete(schema: EntitySchemaType, entity: object, options?: DeleteOptions): Promise<void> {
    if (!isRecord(entity)) {
      throw new TypeError('delete requires an entity object')
    }

    const builder = new Builder()

    // Reset the per-query build state: service instances are reused
    this.buildContext = { deleted: false }

    // Match by the entity's identity: elementId when known, else the
    // primary key — with a clear error when neither is available
    // (matchCriteriaForEntity's "Did you save it first?")
    const criteria = matchCriteriaForEntity(schema, entity)

    builder.matchEntity(THIS_NODE, schema, criteria)

    // Declarative soft delete (NTS-510): SET the label + stamp instead of
    // deleting the node, unless the caller forces a hard delete. The
    // match is gated on the label NOT being there yet: the label is what
    // hides the node from reads, so an already soft-deleted node matches
    // zero rows and a repeat delete is a no-op (deletedAt never re-stamped)
    const soft = schema.getSoftDelete()

    if (soft !== undefined && options?.force !== true) {
      builder.whereLabel(THIS_NODE, soft.label, true)

      builder
        .set(`${THIS_NODE}:${quote(soft.label)}`, undefined)
        .setExpr(`${THIS_NODE}.\`deletedAt\``, 'datetime()')

      // NTS-604: a soft delete is a write like every other — stamp
      // updatedAt and bump the version, so a guarded update hydrated
      // before it no longer matches. The label gate above keeps a repeat
      // soft delete a no-op (NTS-595): zero rows match, nothing re-stamped.
      const updatedAt = timestampProperty(schema, 'updatedAt')

      if (updatedAt !== undefined) {
        builder.setExpr(`${THIS_NODE}.${updatedAt.getKey()}`, SERVER_TIMESTAMP)
      }

      const version = versionProperty(schema)

      if (version !== undefined) {
        builder.setExpr(
          `${THIS_NODE}.${version.getKey()}`,
          versionBump(THIS_NODE, version.getKey()),
        )
      }

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

    // Which relationships cascade: an explicit `{ cascade: true }` (or a
    // detach mode) takes everything, `{ cascade: false }` nothing, and
    // without options the schema's per-relationship annotations decide
    const isAll = options?.cascade === true || options?.mode !== undefined
    const selection: 'all' | 'annotated' = isAll ? 'all' : 'annotated'

    if (isAll && options.mode === 'detach') {
      // Delete the relationships to related nodes first, then the node
      // itself: related nodes survive (neode DeleteNode.js addDetachNode)
      for (const [index, relationship] of schema.getRelationships().entries()) {
        // A previous segment deleted its relationships — carry `this` over
        if (index > 0) {
          builder.withDistinct(THIS_NODE)
        }

        const relationshipAlias = `${THIS_NODE}_${relationship.getKey()}_rel`

        builder
          .optionalMatch(THIS_NODE)
          .relationship(relationship.getType(), relationship.getDirection(), relationshipAlias)
          .toAnything()
          .delete(relationshipAlias)
      }

      builder.detachDelete(THIS_NODE)
    } else if (options?.cascade === false) {
      builder.detachDelete(THIS_NODE)
    } else {
      // Recursively match and delete related nodes, bounded by depth
      // (neode DeleteNode.js addCascadeDeleteNode) — 'annotated' selection
      // walks only the relationships declared `cascade: true`
      for (const relationship of schema.getRelationships()) {
        this.addCascadeDelete(
          builder,
          THIS_NODE,
          relationship,
          1,
          options?.depth ?? MAX_CASCADE_DEPTH,
          selection,
          [THIS_NODE],
        )
      }

      builder.detachDelete(THIS_NODE)
    }

    const { query, params } = builder.build()

    await this.runner.run(query, params)
  }
}
