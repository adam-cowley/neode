import { Builder } from '../../query/index.js'
import { quote } from '../../query/quote.js'
import { getModel } from '../../meta/index.js'
import { EntitySchema, EntityType } from '../../meta/entity/entity-schema.js'
import type { RelationshipPropertySchema } from '../../meta/relationship-property-schema.js'
import { matchCriteriaForEntity } from '../../utilities.js'
import {
  assertCardinality,
  assertWritableDirection,
  setRelationshipEntityProperties,
} from '../write-utilities.js'
import { QueryService } from './query.service.js'
import { NeodeError } from '../../errors/index.js'
import { constructorOf } from '../type-guards.js'

/**
Options for syncEdges (NTS-161): `properties` is applied to the edges
NEWLY related by the sync — common edges are left untouched.
*/
export interface SyncEdgesOptions {
  properties?: (target: object, index: number) => Record<string, unknown>
}

/**
What a sync did: how many edges were related and how many detached
(zero and zero for a no-op sync — nothing is written)
*/
export interface SyncEdgesResult {
  attached: number
  detached: number
}

/**
One traversed edge of the current relationship state: the edge's
elementId plus the far-end node's identity (elementId and primary key)
*/
interface CurrentEdge {
  relId: string
  otherId: string | undefined
  otherPk: unknown
}

/**
A target's identity: its schema plus how it is matched (elementId when
hydrated, else the primary key value)
*/
interface TargetIdentity {
  schema: EntitySchema
  match: ReturnType<typeof matchCriteriaForEntity>
}

/**
The schema to match a target by: the target entity's own model, falling
back to the model declared on the relationship (RelateService parity)
*/
function requireTargetSchema(
  target: object,
  relationship: RelationshipPropertySchema,
): EntitySchema {
  const constructor = constructorOf(target)

  const relationshipTarget = relationship.getTarget()

  const targetSchema =
    (typeof constructor === 'function' ? getModel(constructor) : undefined) ??
    (typeof relationshipTarget === 'function' ? getModel(relationshipTarget) : undefined)

  if (!(targetSchema instanceof EntitySchema)) {
    throw new NeodeError(
      `Couldn't find a model for the target of relationship "${relationship.getKey()}" — ` +
        'register the target model with @NodeEntity or defineModel() first.',
    )
  }

  return targetSchema
}

/**
True when the traversed edge reaches the target the identity describes:
the same elementId, or the same primary-key value (a target matched by
key has no elementId of its own)
*/
function isEdgeMatched(edge: CurrentEdge, identity: TargetIdentity): boolean {
  return (
    (identity.match.elementId !== undefined && identity.match.elementId === edge.otherId) ||
    (edge.otherPk !== undefined && identity.match.value === edge.otherPk)
  )
}

/**
Set the given properties on a merged relationship (RelateService parity:
relationship-entity properties convert through the edge schema, internal
node/relationship references are skipped)
*/
function setEdgeProperties(
  builder: Builder,
  relationship: RelationshipPropertySchema,
  properties: Record<string, unknown>,
): void {
  if (Object.keys(properties).length === 0) {
    return
  }

  const edgeTarget = relationship.getTarget()

  const edgeSchema = typeof edgeTarget === 'function' ? getModel(edgeTarget) : undefined

  if (
    edgeSchema instanceof EntitySchema &&
    edgeSchema.getType() === EntityType.RelationshipEntity
  ) {
    setRelationshipEntityProperties(builder, 'rel', edgeSchema, properties)

    return
  }

  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) {
      builder.set(`rel.${quote(key)}`, value)
    }
  }
}

export class SyncService extends QueryService {
  /**
  Diff-and-apply a relationship's edges to an EXACT target set (NTS-161,
  Eloquent `sync` precedent): relate the missing targets, detach the
  absent ones, leave the common ones untouched (a no-op sync writes
  nothing). Cardinality is checked before any write.
  */
  async sync(
    schema: EntitySchema,
    fromEntity: object,
    relationship: RelationshipPropertySchema,
    targets: object[],
    options: SyncEdgesOptions = {},
  ): Promise<SyncEdgesResult> {
    assertWritableDirection(relationship)

    // The sync would end with one edge per target: a restricted
    // cardinality with two or more targets is a violation before any
    // write happens
    assertCardinality(relationship, targets.length)

    const fromMatch = matchCriteriaForEntity(schema, fromEntity)

    // Identity per target — matchCriteriaForEntity throws for
    // unidentifiable (unsaved) targets
    const targetIdentities: TargetIdentity[] = targets.map((target) => {
      const targetSchema = requireTargetSchema(target, relationship)

      return { schema: targetSchema, match: matchCriteriaForEntity(targetSchema, target) }
    })

    const primaryKey = targetIdentities[0]?.schema.getPrimaryKey()

    // Read the relationship's current edges from the from-node — the
    // diff's only statement when nothing changes
    const scan = new Builder()

    scan
      .matchEntity('from', schema, fromMatch)
      .relationship(relationship.getType(), relationship.getDirection(), 'rel')
      .to('other')
      .return(
        'elementId(rel) AS relId',
        'elementId(other) AS otherId',
        ...(primaryKey === undefined ? [] : [`other.${quote(primaryKey.getKey())} AS otherPk`]),
      )

    const scanQuery = scan.build()

    const scanned = await this.runner.run(scanQuery.query, scanQuery.params)

    const current: CurrentEdge[] = []

    for (const row of scanned.records) {
      const edgeId: unknown = row.get('relId')

      if (typeof edgeId !== 'string') {
        throw new NeodeError('The sync scan did not return an elementId for an existing edge')
      }

      const otherId: unknown = row.get('otherId')

      current.push({
        relId: edgeId,
        otherId: typeof otherId === 'string' ? otherId : undefined,
        otherPk: primaryKey === undefined ? undefined : row.get('otherPk'),
      })
    }

    // Edges whose far end is not among the targets go; targets no edge
    // reaches come
    const toDetach = current.filter((edge) =>
      targetIdentities.every((identity) => !isEdgeMatched(edge, identity)),
    )

    const toRelate: { target: object; identity: TargetIdentity; index: number }[] = []

    for (const [index, identity] of targetIdentities.entries()) {
      const target = targets[index]

      if (target !== undefined && current.every((edge) => !isEdgeMatched(edge, identity))) {
        toRelate.push({ target, identity, index })
      }
    }

    // Detach first, then relate — a one-cardinality sync that replaces
    // its edge never transiently holds two
    if (toDetach.length > 0) {
      const detach = new Builder()

      detach
        .match('from_node')
        .relationship(relationship.getType(), relationship.getDirection(), 'rel')
        .toAnything()
        .whereRaw('elementId(rel) IN $relIds')
        .param(
          'relIds',
          toDetach.map((edge) => edge.relId),
        )
        .delete('rel')

      const detachQuery = detach.build()

      await this.runner.run(detachQuery.query, detachQuery.params)
    }

    for (const { target, identity, index } of toRelate) {
      const relate = new Builder()

      relate
        .matchEntity('from', schema, fromMatch)
        .matchEntity('to', identity.schema, identity.match)
        .merge('from')
        .relationship(relationship.getType(), relationship.getDirection(), 'rel')
        .to('to')

      const properties = options.properties?.(target, index) ?? {}

      setEdgeProperties(relate, relationship, properties)

      const relateQuery = relate.build()

      await this.runner.run(relateQuery.query, relateQuery.params)
    }

    return { attached: toRelate.length, detached: toDetach.length }
  }
}
