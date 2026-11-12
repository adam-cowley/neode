import { Builder, RawExpression } from '../../query/index.js'
import { INTERNAL_ID, THIS_NODE } from '../../constants.js'
import type { QueryOutput, QuerySummary } from '../../driver/types.js'
import { getModel } from '../../meta/index.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { EntityType } from '../../meta/entity/entity-schema.js'
import type { PropertySchema } from '../../meta/property-schema.js'
import { isProjectedProperty } from '../../meta/property-schema.js'
import type { RelationshipPropertySchema } from '../../meta/relationship-property-schema.js'
import { getValueOrDefault, getValuesAsRecord, setPropertyInBuilder } from '../../utilities.js'
import { elementIdOfEntity } from '../../element-id.js'
import {
  stampExpression,
  versionBump,
  applyEmbeddings,
  applyFakeValues,
  applyInTransforms,
  createNodeAndRelationships,
  deriveProperties,
  getOtherProperty,
  assertCardinality,
  assertWritableDirection,
  modelPropertyValues,
  resolveEnforceClaim,
  setPropertyExpression,
  setRelationshipEntityProperties,
  timestampProperty,
  versionProperty,
  MAX_SAVE_DEPTH,
  type EnforceClaim,
} from '../write-utilities.js'
import { quote } from '../../query/quote.js'
import { validate } from '../../validation/index.js'
import { NeodeError, OptimisticLockError } from '../../errors/index.js'
import { QueryService } from './query.service.js'
import { assertPkTarget } from '../relationship-values.js'
import { isRecord } from '../type-guards.js'

/**
Properties used for merge matching: unique OR indexed
(neode's Model.mergeFields)
*/
export function getMergeFields(schema: EntitySchema): PropertySchema[] {
  return schema.getProperties().filter((property) => property.isUnique() || property.isIndex())
}

/**
Options for MergeService.save
*/
export interface MergeSaveOptions {
  /**
  Optimistic locking (NTS-158): this save is a nested relationship-target
  write reached through another node's save — the target's @Version is
  neither checked nor bumped (SDN issue 2604 lesson: version never
  cascades across related nodes). A genuinely created target still starts
  at version 0.
  */
  nested?: boolean

  /**
  NTS-597: nesting level of this save within the relationship walk —
  nested saves pass depth + 1, and a graph nested deeper than
  MAX_SAVE_DEPTH (a cycle) throws instead of overflowing the stack
  */
  depth?: number
}

/**
Server-side timestamps on a MERGE (NTS-165): `createdAt` stamps on create
only, `updatedAt` on create and on match. The expressions render after the
MERGE pattern and before the plain SET clauses, so an explicitly written
timestamp value in the same statement overrides the stamp.
*/
function stampMergeTimestamps(builder: Builder, schema: EntitySchema): void {
  for (const kind of ['createdAt', 'updatedAt'] as const) {
    const property = timestampProperty(schema, kind)

    if (property === undefined) {
      continue
    }

    const key = `${THIS_NODE}.${property.getKey()}`

    builder.onCreateSetExpr(key, stampExpression(property))

    if (kind === 'updatedAt') {
      builder.onMatchSetExpr(key, stampExpression(property))
    }
  }
}

/**
Optimistic locking on a MERGE (NTS-158): a created node starts at version
0. `bump` also increments on the match path — off when a guard statement
already checked-and-incremented the version, or when the save is a nested
relationship-target write (version never cascades).
*/
function stampMergeVersion(builder: Builder, schema: EntitySchema, shouldBump: boolean): void {
  const property = versionProperty(schema)

  if (property === undefined) {
    return
  }

  const key = `${THIS_NODE}.${property.getKey()}`

  builder.onCreateSetExpr(key, '0')

  if (shouldBump) {
    builder.onMatchSetExpr(key, versionBump(THIS_NODE, property.getKey()))
  }
}

export class MergeService extends QueryService {
  /**
  Optimistic-lock guard (NTS-158): when the model declares @Version and the
  instance carries the numeric version it was hydrated with (or, for an
  untracked instance such as a DTO, the version it supplies — NTS-580),
  match the node by elementId (else by the merge keys) AND its stored
  version, incrementing it in the same statement — the write lock the SET
  takes makes the check-and-increment atomic, so a concurrent guarded save
  serialises behind this one. Zero matched rows throws OptimisticLockError
  when the node moved on or is gone (tracked), or exists at another version
  (untracked — an absent node is simply a create). Returns whether the
  guard ran and bumped.

  shortcut: the check is its own statement ahead of the MERGE, not part of
  it (a MERGE cannot carry a WHERE on its match); under autocommit a
  failure between the two leaves the bump applied. It runs after
  validation, derived and embedding resolution so those never strand a bump.
  */
  private async guardVersion(
    model: object,
    schema: EntitySchema,
    mergeOn: Record<string, unknown>,
  ): Promise<boolean> {
    const property = versionProperty(schema)

    if (property === undefined) {
      return false
    }

    const key = property.getKey()

    const expectedVersion: unknown = Reflect.get(model, key)

    if (typeof expectedVersion !== 'number') {
      return false
    }

    const elementId = elementIdOfEntity(schema, model)

    if (elementId === undefined && Object.keys(mergeOn).length === 0) {
      return false
    }

    const builder = new Builder()

    if (elementId === undefined) {
      builder.match(THIS_NODE, schema.getLabels(), mergeOn)
    } else {
      builder.match(THIS_NODE).whereId(THIS_NODE, elementId)
    }

    builder
      .whereRaw(`${THIS_NODE}.${key} = $expectedVersion`)
      .setExpr(`${THIS_NODE}.${key}`, versionBump(THIS_NODE, key), { expectedVersion })
      .return(THIS_NODE, `elementId(${THIS_NODE}) AS ${INTERNAL_ID}`)

    const { query, params } = builder.build()

    const result = await this.runner.run(query, params)

    if (result.records.length > 0) {
      return true
    }

    if (elementId === undefined) {
      // Untracked: no match is a conflict only when the node exists at
      // another version; otherwise the MERGE below creates it
      const existing = new Builder()
        .match(THIS_NODE, schema.getLabels(), mergeOn)
        .return(`elementId(${THIS_NODE}) AS ${INTERNAL_ID}`)
        .build()

      const found = await this.runner.run(existing.query, existing.params)

      if (found.records.length === 0) {
        return false
      }
    }

    throw new OptimisticLockError(schema.getLabels().join(':'))
  }

  private async relateNodes(
    fromId: string,
    toId: string,
    relationship: RelationshipPropertySchema,
    targetSchema: EntitySchema,
    entity: unknown,
    claim?: EnforceClaim,
  ): Promise<unknown> {
    assertWritableDirection(relationship)

    const fromNode = 'from'
    const toNode = 'to'
    const thisRelationship = 'rel'

    const builder = new Builder()

    // Match nodes by element ID, falling back to a merge if unknown
    builder
      .match(fromNode)
      .whereId(fromNode, fromId)
      .match(toNode)
      .whereId(toNode, toId)

      // Merge Relationship
      .merge(fromNode)
      .relationship(relationship.getType(), relationship.getDirection(), thisRelationship)
      .to(toNode)

    // Set relationship properties
    if (targetSchema.getType() === EntityType.RelationshipEntity && isRecord(entity)) {
      setRelationshipEntityProperties(builder, thisRelationship, targetSchema, entity)
    }

    // NTS-663: an enforce relationship claims its target
    if (claim !== undefined) {
      builder.set(`to.${quote(claim.property)}`, claim.value)
    }

    const { query, params } = builder.build()

    return this.runner.run(query, params)
  }

  /**
  Relate an EXISTING node by primary-key value (NTS-627): the save-path
  counterpart of the create path's root-statement targets — MERGE keeps
  the round-trip idempotent (the edge never duplicates). Zero matched rows
  (unknown primary key) fails loudly naming the key and value.
  */
  private async relateExisting(
    fromId: string,
    relationship: RelationshipPropertySchema,
    targetSchema: EntitySchema,
    value: unknown,
    claim?: EnforceClaim,
  ): Promise<void> {
    const primaryKey = assertPkTarget(relationship, targetSchema, value)

    const builder = new Builder()

    builder.match('from').whereId('from', fromId)
    builder.match('to', targetSchema.getLabels(), { [primaryKey.getKey()]: value })

    builder
      .merge('from')
      .relationship(relationship.getType(), relationship.getDirection(), 'rel')
      .to('to')

    // NTS-663: an enforce relationship claims its target
    if (claim !== undefined) {
      builder.set(`to.${quote(claim.property)}`, claim.value)
    }

    builder.return('to')

    const { query, params } = builder.build()

    const result = await this.runner.run(query, params)

    if (result.records.length === 0) {
      throw new NeodeError(
        `Cannot relate "${relationship.getKey()}": no ${targetSchema.getLabels().join(':')} node ` +
          `matched { ${primaryKey.getKey()}: ${String(value)} } — check the value exists`,
      )
    }
  }

  /**
  MERGE a node on the given match properties, then set the given properties
  */
  async mergeOn(
    schema: EntitySchema,
    match: Record<string, unknown>,
    set: Record<string, unknown> = {},
  ): Promise<QueryOutput> {
    // Skip undefined match values
    const matchRecord = Object.fromEntries(
      Object.entries(match).filter(([, value]) => value !== undefined),
    )

    if (Object.keys(matchRecord).length === 0) {
      throw new NeodeError('mergeOn requires at least one match property')
    }

    // Resolve embedding sugar (NTS-449) onto the set values first: a
    // vector property declared with `from` + `provider` computes its
    // vector from the source property being written, unless the vector
    // itself is explicitly provided. Stored derived properties (NTS-569)
    // resolve the same way — compute-side onto the set record, cypher-side
    // appended after the SET clause
    await applyEmbeddings(schema, set)

    const derived = deriveProperties(schema, set)

    // Apply `in` transforms (NTS-449): user value -> stored form, on
    // both the match and set values, before validation
    await applyInTransforms(schema, matchRecord)
    await applyInTransforms(schema, set)

    // Validate the combined match + set values before writing (neode
    // validates both), with the same defaults the set clause applies
    const written: Record<string, unknown> = { ...matchRecord }

    for (const property of schema.getProperties()) {
      if (Object.hasOwn(matchRecord, property.getKey()) || isProjectedProperty(property)) {
        continue
      }

      const value = getValueOrDefault(set, property, schema)

      if (value !== undefined) {
        written[property.getKey()] = value
      }
    }

    validate(written, schema)

    const builder = new Builder()

    builder.merge(THIS_NODE, schema.getLabels(), matchRecord)

    // Set Properties: explicit set values, falling back to schema
    // defaults (e.g. a UUID primary key on create). Unset values are
    // skipped rather than deleted.
    for (const property of schema.getProperties()) {
      const key = property.getKey()

      // Match properties are inline in the MERGE, not set; projected
      // read-model values are never written
      if (Object.hasOwn(matchRecord, key) || isProjectedProperty(property)) {
        continue
      }

      const value = getValueOrDefault(set, property, schema)

      // NTS-629: expression values render verbatim as SET clauses
      if (value instanceof RawExpression) {
        setPropertyExpression(builder, THIS_NODE, property, value)
      } else if (value !== undefined) {
        setPropertyInBuilder(builder, THIS_NODE, property, value)
      }
    }

    // Extra keys not declared on the schema are plain property sets
    for (const [key, value] of Object.entries(set)) {
      if (
        value === undefined ||
        schema.getProperties().some((property) => property.getKey() === key)
      ) {
        continue
      }

      builder.set(`${THIS_NODE}.${quote(key)}`, value)
    }

    // Cypher-side derived properties (NTS-569): evaluated after the SET
    // clause, so the expressions read the new source values
    for (const { key, cypher } of derived.cypherSets) {
      builder.setExpr(`${THIS_NODE}.${quote(key)}`, cypher)
    }

    // Server-side timestamps (NTS-165): createdAt stamps on create,
    // updatedAt on every write — an explicitly provided match/set value
    // overrides the stamp in the same statement
    stampMergeTimestamps(builder, schema)

    // Optimistic locking (NTS-158): version starts at 0 on create and
    // bumps by 1 on every matched write. mergeOn carries no expected
    // version in its API, so it never guards — it only maintains the
    // counter (a guarded write throws OptimisticLockError on mismatch).
    stampMergeVersion(builder, schema, true)

    builder.return(THIS_NODE, `elementId(${THIS_NODE}) AS ${INTERNAL_ID}`)

    const { query, params } = builder.build()

    return this.runner.run(query, params)
  }

  async save(
    model: object,
    schema: EntitySchema,
    dirtyKeys?: ReadonlySet<string>,
    options: MergeSaveOptions = {},
  ): Promise<{
    elementId: string
    created: boolean
    summary: QuerySummary | undefined
    output: QueryOutput
  }> {
    if (!isRecord(model)) {
      throw new TypeError('save requires a model object')
    }

    // Depth cap (NTS-597): a cyclic nested graph would recurse through the
    // relationship walk below until the stack overflows — the create path
    // caps at MAX_CREATE_DEPTH, the merge path throws instead (silently
    // dropping nested writes would lose data)
    const depth = options.depth ?? 0

    if (depth >= MAX_SAVE_DEPTH) {
      throw new NeodeError(
        `save() nested more than ${String(MAX_SAVE_DEPTH)} relationship levels deep — the object graph is ` +
          'probably cyclic. Break the cycle, or save the objects in smaller pieces.',
      )
    }

    // Resolve embedding sugar (NTS-449): a vector property declared with
    // `from` + `provider` computes its vector from the source property
    // being written, unless the vector itself is explicitly provided.
    // Tracked saves (NTS-157) recompute only from a dirty source; the
    // recomputed keys join the write set — their stored value is stale
    // by definition, even though the instance itself did not change them
    const recomputedEmbeddings = await applyEmbeddings(schema, model, dirtyKeys)

    // Stored derived properties (NTS-569): compute-side values land on the
    // model (transforms and validation see them; the recomputed keys join
    // the write set), cypher-side sets are appended after the SET clause
    const derived = deriveProperties(schema, model, dirtyKeys)

    // Apply `in` transforms (NTS-449): user value -> stored form, before
    // validation, so validation and the write see the same value
    await applyInTransforms(schema, model)

    // Validate the model's own values (defaults resolved) before any write
    validate(modelPropertyValues(model, schema), schema)

    const builder = new Builder()

    // Primary Key?
    const primaryKeys = schema
      .getProperties()
      .filter(
        (property) =>
          property.isPrimaryKey() &&
          Object.hasOwn(model, property.getKey()) &&
          model[property.getKey()] !== undefined,
      )

    // Primary keys when set, otherwise the merge fields (unique or indexed)
    const mergeOn = getValuesAsRecord(
      model,
      primaryKeys.length > 0 ? primaryKeys : getMergeFields(schema),
      schema,
    )

    // Optimistic locking (NTS-158): an instance carrying a numeric version
    // checks-and-increments it before the merge — zero matched rows means
    // the node changed (or vanished) under another transaction. Runs only
    // after validation / derived / embeddings succeeded, so a failure there
    // never leaves the version bumped (NTS-580). Nested relationship-target
    // writes never guard or bump: version is per node only (SDN issue 2604
    // lesson).
    const isVersionGuarded =
      options.nested === true ? false : await this.guardVersion(model, schema, mergeOn)

    if (Object.keys(mergeOn).length === 0) {
      // Nothing to merge on: the entity carries no identity, so save() is
      // a CREATE. (A bare MERGE (this:Label) would match an arbitrary
      // existing node of the label and overwrite it.)
      applyFakeValues(schema, model)

      validate(modelPropertyValues(model, schema), schema)

      const { elementId, output } = await createNodeAndRelationships(this.runner, schema, model)

      return { elementId, created: true, summary: undefined, output }
    }

    builder.merge(THIS_NODE, schema.getLabels(), mergeOn)

    // Set Properties
    for (const property of schema.getProperties()) {
      // Projected read-model values are never written
      // @Version is library-managed (NTS-580): the guard / ON MATCH bump
      // owns it, so the instance's (possibly stale) value is never written
      if (isProjectedProperty(property) || property.isVersion()) {
        continue
      }

      // NTS-157: tracked instances write only their dirty keys — plus
      // vector and derived properties recomputed from a dirty source above
      if (
        dirtyKeys !== undefined &&
        !dirtyKeys.has(property.getKey()) &&
        !recomputedEmbeddings.includes(property.getKey()) &&
        !derived.recomputed.includes(property.getKey())
      ) {
        continue
      }

      const value = getValueOrDefault(model, property, schema)

      // If property is not set then ignore it. NTS-629: expression values
      // render verbatim as SET clauses
      if (value instanceof RawExpression) {
        setPropertyExpression(builder, THIS_NODE, property, value)
      } else if (value !== undefined) {
        setPropertyInBuilder(builder, THIS_NODE, property, value)
      }
    }

    // Cypher-side derived properties (NTS-569): evaluated by the database
    // after the sources are SET, so the expressions read the new values
    for (const { key, cypher } of derived.cypherSets) {
      builder.setExpr(`${THIS_NODE}.${quote(key)}`, cypher)
    }

    // Server-side timestamps (NTS-165): every real write stamps updatedAt
    // (and createdAt when the merge creates). A tracked clean instance
    // never reaches this point — the facade skips the write entirely.
    if (dirtyKeys === undefined || dirtyKeys.size > 0) {
      stampMergeTimestamps(builder, schema)
    }

    // Optimistic locking (NTS-158): version starts at 0 on create; the
    // match-path bump only applies when no guard statement already
    // incremented it and this is not a nested relationship-target write
    if (dirtyKeys === undefined || dirtyKeys.size > 0) {
      stampMergeVersion(builder, schema, !isVersionGuarded && options.nested !== true)
    }

    builder.return(THIS_NODE, `elementId(${THIS_NODE}) AS ${INTERNAL_ID}`)

    // Build Cypher
    const { query, params } = builder.build()

    // Run it!
    const result = await this.runner.run(query, params)

    // Was the merge a create or a match? The root statement's summary
    // counters say — the nested relationship writes below also create
    // nodes, so this must be read from the root merge, not at the end.
    // Neo4j names the counter nodesCreated, the Relate engine nodes_created.
    const counters = result.summary?.counters ?? {}

    const wasCreated = (counters['nodesCreated'] ?? counters['nodes_created'] ?? 0) > 0

    // Get element ID
    const firstRecord = result.records[0]

    if (firstRecord === undefined) {
      throw new NeodeError('relate statement returned no records')
    }

    const thisId: unknown = firstRecord.get(INTERNAL_ID)

    if (typeof thisId !== 'string') {
      throw new TypeError(`relate statement did not return an ${INTERNAL_ID}`)
    }

    // Save relationship targets in the same transaction. Tracked saves
    // (NTS-157) never walk the graph: relationship writes belong to the
    // explicit relate()/detach() paths.
    if (dirtyKeys !== undefined) {
      return { elementId: thisId, created: wasCreated, summary: result.summary, output: result }
    }

    await Promise.all(
      schema.getRelationships().map(async (relationship) => {
        const key = relationship.getKey()

        const propertyValue: unknown = model[key]

        // If property is not set (or falsy) then ignore it
        const hasValue = Object.hasOwn(model, key) && Boolean(propertyValue)

        if (!hasValue) {
          return
        }

        // Reject before saving any targets: BOTH is match-only (NTS-483)
        assertWritableDirection(relationship)

        const value = propertyValue

        const values: unknown[] = relationship.getMany() && Array.isArray(value) ? value : [value]

        // A one-cardinality relationship cannot be saved with two targets
        // (NTS-161). The values are the write's own edges — the explicit
        // relate() path additionally guards against edges already in the
        // database.
        assertCardinality(relationship, values.length)

        const targetEntity = relationship.getTarget()

        const targetSchema = getModel(targetEntity)

        // NTS-663: the merged source claims its targets
        const claim = resolveEnforceClaim(relationship, schema, model, targetSchema)

        if (targetSchema.getType() === EntityType.RelationshipEntity) {
          return Promise.all(
            values.map(async (element) => {
              if (!isRecord(element)) {
                throw new TypeError(`The value of relationship "${key}" must be an object to save`)
              }

              const otherProperty = getOtherProperty(relationship, targetSchema, targetEntity)

              const otherModel: unknown = element[otherProperty.getKey()]

              if (!isRecord(otherModel)) {
                throw new TypeError(
                  `The value of "${otherProperty.getKey()}" on the relationship entity must be an object`,
                )
              }

              // The node at the far end is saved with ITS OWN schema —
              // the relationship entity's schema only describes the
              // relationship between the two nodes
              const otherEntity = otherProperty.getEntity()

              if (otherEntity === undefined) {
                throw new NeodeError(
                  `The relationship entity has no target entity — declare the target model with @NodeEntity or defineModel() first`,
                )
              }

              const otherSchema = getModel(otherEntity)

              const saved = await this.save(otherModel, otherSchema, undefined, {
                nested: true,
                depth: depth + 1,
              })

              await this.relateNodes(
                thisId,
                saved.elementId,
                relationship,
                targetSchema,
                element,
                claim,
              )
            }),
          )
        }

        return Promise.all(
          values.map(async (element) => {
            // NTS-627: a primary-key value relates an EXISTING node in one
            // MERGE statement — entity instances keep the nested save walk
            if (!isRecord(element)) {
              await this.relateExisting(thisId, relationship, targetSchema, element, claim)

              return
            }

            // Save Node — a nested relationship-target write: the target's
            // version is never guarded or bumped (NTS-158)
            const saved = await this.save(element, targetSchema, undefined, {
              nested: true,
              depth: depth + 1,
            })

            // Relate the two nodes together
            await this.relateNodes(
              thisId,
              saved.elementId,
              relationship,
              targetSchema,
              element,
              claim,
            )
          }),
        )
      }),
    )

    return { elementId: thisId, created: wasCreated, summary: result.summary, output: result }
  }
}

/**
Aggregated write counters of a merge write (NTS-630): nodes and
relationships count their creates + deletes, properties counts SET
operations.
*/
export interface MergeCounts {
  nodes: number
  relationships: number
  properties: number
}

/**
What a merge write did (NTS-630), derived from the driver summary's write
counters: `created` when the MERGE created the node, `updated` when it
matched and wrote to it — both false when nothing changed.
*/
export interface MergeOutcome {
  created: boolean
  updated: boolean
  counts: MergeCounts
}

/**
The result of merge() / mergeOn() (NTS-630): the hydrated entity plus the
write outcome and the raw driver summary preserved for power users.
Breaking (1.0.0-next): replaces the bare-entity return.
*/
export interface MergeResult<T> extends MergeOutcome {
  entity: T
  counts: MergeCounts
  summary: QuerySummary | undefined
}

/**
Derive the merge outcome from a statement summary's write counters. The
backends name the counters differently (neo4j: nodesCreated, the Relate
engine: nodes_created) — both spellings are read.
*/
export function mergeOutcome(summary: QuerySummary | undefined): MergeOutcome {
  const counters = summary?.counters ?? {}

  const nodesCreated = counters['nodesCreated'] ?? counters['nodes_created'] ?? 0
  const nodesDeleted = counters['nodesDeleted'] ?? counters['nodes_deleted'] ?? 0
  const relationshipsCreated =
    counters['relationshipsCreated'] ?? counters['relationships_created'] ?? 0
  const relationshipsDeleted =
    counters['relationshipsDeleted'] ?? counters['relationships_deleted'] ?? 0
  const properties = counters['propertiesSet'] ?? counters['properties_set'] ?? 0

  // A created node's own property sets are part of the create, not an
  // update — only a matched write counts
  const wasCreated = nodesCreated > 0

  const didWrite =
    nodesCreated + nodesDeleted + relationshipsCreated + relationshipsDeleted + properties > 0

  return {
    created: wasCreated,
    updated: !wasCreated && didWrite,
    counts: {
      nodes: nodesCreated + nodesDeleted,
      relationships: relationshipsCreated + relationshipsDeleted,
      properties,
    },
  }
}

/**
Wrap a save() outcome into a MergeResult (NTS-630): the save path knows
`created` from its own statement, but the pure-CREATE branch (no merge
fields) carries no summary — its counters stay unreported (zeros) while
the created flag stands.
*/
export function mergeResultFromSave<T>(
  entity: T,
  wasCreated: boolean,
  summary: QuerySummary | undefined,
): MergeResult<T> {
  const outcome = mergeOutcome(summary)

  return {
    entity,
    created: wasCreated || outcome.created,
    updated: outcome.updated,
    counts: outcome.counts,
    summary,
  }
}
