import { Builder, RawExpression } from '../../query/index.js'
import { quote } from '../../query/quote.js'
import { THIS_NODE } from '../../constants.js'
import { getModel } from '../../meta/index.js'
import { EntitySchema } from '../../meta/entity/entity-schema.js'
import type { RelationshipPropertySchema } from '../../meta/relationship-property-schema.js'
import { matchCriteriaForEntity } from '../../utilities.js'
import { QueryService } from './query.service.js'
import { NeodeError } from '../../errors/index.js'
import { assertWritableDirection, validateEdgeProperties } from '../relationship-values.js'
import { assertCardinality, resolveEnforceClaim } from '../write-utilities.js'
import { isRecord } from '../type-guards.js'

/**
Options for {@link ReplaceRelationshipService.replaceRelationship}
*/
export interface ReplaceRelationshipOptions {
  /**
  MERGE the new edges instead of CREATEing them (relate() parity): a
  re-run over an edge that already exists leaves it untouched instead of
  duplicating it. Default: CREATE — the statement deletes the
  relationship's existing edges first, so both modes leave exactly the
  target set.
  */
  merge?: boolean
}

export class ReplaceRelationshipService extends QueryService {
  /**
  Replace every edge of ONE declared relationship on a node in a single
  statement (NTS-634): guard-MATCH the owning node by its identity, delete
  its existing edges of the relationship's type in the declared direction,
  then UNWIND the target primary keys and create one edge per target.
  `properties` are SET on every created (or merged) edge.

  The old-edge delete uses the delete-path binding (NTS-565 carve-out): an
  OPTIONAL MATCH keeps the row alive when no edges exist — a plain MATCH
  would drop the row and silently skip the creates. Targets missing from
  the graph are skipped by their MATCH (no edge is created for them); a
  missing owning node leaves the whole statement a no-op.
  */
  async replaceRelationship(
    schema: EntitySchema,
    entity: object,
    relationship: RelationshipPropertySchema,
    targets: unknown[],
    properties: Record<string, unknown> = {},
    options: ReplaceRelationshipOptions = {},
  ): Promise<void> {
    if (!isRecord(entity)) {
      throw new TypeError('replaceRelationship requires an entity object')
    }

    // BOTH is match-only — same rejection as relate() (NTS-483)
    assertWritableDirection(relationship)

    // The replace ends with exactly one edge per target: a restricted
    // cardinality with two or more targets is a violation before any
    // write happens (same contract as syncEdges, NTS-161)
    assertCardinality(relationship, targets.length)

    // NTS-628: edge properties validate against the relationship's
    // declared `properties` schema (relate() parity)
    validateEdgeProperties(relationship, properties)

    const targetConstructor = relationship.getTarget()

    const targetSchema =
      typeof targetConstructor === 'function' ? getModel(targetConstructor) : undefined

    if (!(targetSchema instanceof EntitySchema)) {
      throw new NeodeError(
        `Couldn't find a model for the target of relationship "${relationship.getKey()}" — ` +
          'register it with @NodeEntity or defineModel() first.',
      )
    }

    const primaryKey = targetSchema.getPrimaryKey()

    if (primaryKey === undefined) {
      throw new NeodeError(
        `Cannot replace "${relationship.getKey()}": the target model ` +
          `"${targetSchema.getLabels().join(':') || 'entity'}" declares no primary key`,
      )
    }

    // Entity instances resolve to their primary-key value; plain values
    // pass through (they ARE the primary keys)
    const targetIds = targets.map((target) => {
      if (!isRecord(target)) {
        return target
      }

      const value = Reflect.get(target, primaryKey.getKey())

      if (value === undefined || value === null) {
        throw new NeodeError(
          `Cannot replace "${relationship.getKey()}": a target instance is missing ` +
            `a ${primaryKey.getKey()} value — pass the primary-key value directly`,
        )
      }

      return value
    })

    // NTS-663: the replace re-claims the enforce property — REMOVE it from
    // the detached targets and SET it on the new ones, in this one
    // statement (the NTS-634 atomic swap, no stale-claim window)
    const claim = resolveEnforceClaim(relationship, schema, entity, targetSchema)

    const builder = new Builder()

    // Guard-MATCH the owning node by its identity — no pre-read
    builder.matchEntity(THIS_NODE, schema, matchCriteriaForEntity(schema, entity))

    // Delete-path binding (NTS-565 carve-out): the OPTIONAL MATCH keeps
    // the row alive when the relationship has no existing edges
    const oldEdge = builder
      .optionalMatch(THIS_NODE)
      .relationship(relationship.getType(), relationship.getDirection(), 'old_rel')

    if (claim === undefined) {
      oldEdge.toAnything()
    } else {
      oldEdge.to('old_target')
    }

    oldEdge.delete('old_rel')

    // REMOVE on a null old_target (no existing edges) is a no-op
    if (claim !== undefined) {
      builder.remove(`old_target.${quote(claim.property)}`)
    }

    builder.with(THIS_NODE)

    builder.param('targets', targetIds)

    builder.unwind('$targets', 't')

    builder.match('target_node', targetSchema.getLabels(), {
      [primaryKey.getKey()]: new RawExpression('t'),
    })

    if (options.merge === true) {
      builder
        .merge(THIS_NODE)
        .relationship(relationship.getType(), relationship.getDirection(), 'new_rel')
        .to('target_node')
    } else {
      builder
        .create(THIS_NODE)
        .relationship(relationship.getType(), relationship.getDirection(), 'new_rel')
        .to('target_node')
    }

    for (const [key, value] of Object.entries(properties)) {
      if (value !== undefined) {
        builder.set(`new_rel.${quote(key)}`, value)
      }
    }

    // NTS-663: claim the new target — SET is a no-op when the target did
    // not match (its row is skipped)
    if (claim !== undefined) {
      builder.set(`target_node.${quote(claim.property)}`, claim.value)
    }

    const { query, params } = builder.build()

    await this.runner.run(query, params)
  }
}
