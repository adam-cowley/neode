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
A target resolved against the database: its schema, the elementId of the
stored node (matched by elementId, or by primary key constrained to the
target's labels) and its position in the caller's target list
*/
interface ResolvedTarget {
  schema: EntitySchema
  elementId: string
  index: number
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
  Resolve each target to the elementId of its stored node, constrained to
  the target model's labels. Throws one NeodeError listing every target
  that is not in the database (nothing has been written at that point).
  */
  private async resolveTargets(
    relationship: RelationshipPropertySchema,
    targets: object[],
  ): Promise<ResolvedTarget[]> {
    const resolved: ResolvedTarget[] = []

    const missing: string[] = []

    for (const [index, target] of targets.entries()) {
      // Throws for unidentifiable (unsaved) targets
      const targetSchema = requireTargetSchema(target, relationship)

      const match = matchCriteriaForEntity(targetSchema, target)

      const lookup = new Builder()

      if (match.elementId === undefined || match.elementId === '') {
        lookup.matchEntity('to', targetSchema, match)
      } else {
        lookup.match('to', targetSchema.getLabels()).whereId('to', match.elementId)
      }

      lookup.return('elementId(to) AS targetId')

      const lookupQuery = lookup.build()

      const found = await this.runner.run(lookupQuery.query, lookupQuery.params)

      const targetId: unknown = found.records[0]?.get('targetId')

      if (typeof targetId === 'string') {
        resolved.push({ schema: targetSchema, elementId: targetId, index })
      } else {
        const label = targetSchema.getLabels().join(':')

        missing.push(
          match.elementId === undefined || match.elementId === ''
            ? `${label} with ${match.key} = ${String(match.value)}`
            : `${label} with elementId ${match.elementId}`,
        )
      }
    }

    if (missing.length > 0) {
      throw new NeodeError(
        `Cannot sync relationship "${relationship.getKey()}": ${String(missing.length)} target(s) ` +
          `do not exist in the database (${missing.join(', ')}). ` +
          'Save the missing targets first (or remove them from the target list); ' +
          'no edges were changed.',
      )
    }

    return resolved
  }

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

    // Resolve every target to its stored node BEFORE anything is written
    // (NTS-579): a target missing from the database would otherwise match
    // zero rows on relate, after the stale edges were already detached.
    const resolved = await this.resolveTargets(relationship, targets)

    // Read the relationship's current edges from the from-node — the
    // diff's only write-free statement when nothing changes. Compared by
    // elementId alone: primary-key values may be driver Integers (never
    // `===` equal) and a node of another label can share a key.
    const scan = new Builder()

    scan
      .matchEntity('from', schema, fromMatch)
      .relationship(relationship.getType(), relationship.getDirection(), 'rel')
      .to('other')
      .return('elementId(rel) AS relId', 'elementId(other) AS otherId')

    const scanQuery = scan.build()

    const scanned = await this.runner.run(scanQuery.query, scanQuery.params)

    const current: { relId: string; otherId: string }[] = []

    for (const row of scanned.records) {
      const edgeId: unknown = row.get('relId')
      const otherId: unknown = row.get('otherId')

      if (typeof edgeId !== 'string' || typeof otherId !== 'string') {
        throw new NeodeError('The sync scan did not return an elementId for an existing edge')
      }

      current.push({ relId: edgeId, otherId })
    }

    const wanted = new Set(resolved.map((target) => target.elementId))

    const reached = new Set(current.map((edge) => edge.otherId))

    // Edges whose far end is not among the targets go; targets no edge
    // reaches come (once each, however often a target is listed)
    const toDetach = current.filter((edge) => !wanted.has(edge.otherId))

    const queued = new Set<string>()

    const toRelate = resolved.filter((target) => {
      if (reached.has(target.elementId) || queued.has(target.elementId)) {
        return false
      }

      queued.add(target.elementId)

      return true
    })

    // Detach first, then relate — a one-cardinality sync that replaces
    // its edge never transiently holds two
    if (toDetach.length > 0) {
      const detach = new Builder()

      // Anchored on the from-node: only its own edges are scanned
      detach
        .matchEntity('from', schema, fromMatch)
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

    let attached = 0

    for (const { schema: targetSchema, elementId, index } of toRelate) {
      const target = targets[index]

      const relate = new Builder()

      relate
        .matchEntity('from', schema, fromMatch)
        .match('to', targetSchema.getLabels())
        .whereId('to', elementId)
        .merge('from')
        .relationship(relationship.getType(), relationship.getDirection(), 'rel')
        .to('to')

      const properties = target === undefined ? {} : (options.properties?.(target, index) ?? {})

      setEdgeProperties(relate, relationship, properties)

      relate.return('elementId(rel) AS relId')

      const relateQuery = relate.build()

      const related = await this.runner.run(relateQuery.query, relateQuery.params)

      // Truthful count: a statement that matched nothing attached nothing
      attached += related.records.length
    }

    return { attached, detached: toDetach.length }
  }
}
