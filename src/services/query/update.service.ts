import { Builder, type EntityMatchCriteria } from '../../query/index.js'
import { quote } from '../../query/quote.js'
import { INTERNAL_ID, THIS_NODE } from '../../constants.js'
import { matchCriteriaForEntity } from '../../utilities.js'
import type { GraphNode, QueryOutput } from '../../driver/types.js'
import { NON_VALUE_TYPES, isProjectedProperty } from '../../meta/property-schema.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { validate } from '../../validation/index.js'
import { QueryService } from './query.service.js'
import { isGraphNode } from '../type-guards.js'
import {
  stampExpression,
  versionBump,
  applyEmbeddings,
  applyInTransforms,
  deriveProperties,
  timestampProperty,
  versionProperty,
} from '../write-utilities.js'
import { OptimisticLockError } from '../../errors/index.js'

/**
A compare-and-swap guard for the conditional update path (NTS-688):
rendered verbatim as a WHERE predicate on the matched node — trusted-input
only, the same class as `whereRaw()` / `@Expression`. Reference the node as
`this`. Values go through `params`, bound as Cypher parameters.
*/
export interface UpdateGuard {
  where: string
  params?: Record<string, unknown>
}

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

  With a `guard` (NTS-688) the write only lands when the predicate holds on
  the matched node — zero matched rows means the guard failed (or the node
  is gone); a version-guarded update still throws `OptimisticLockError`.

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
    guard?: UpdateGuard,
  ): Promise<QueryOutput> {
    const identityCriteria = matchCriteriaForEntity(schema, entity)

    // Resolve embedding sugar (NTS-449) and `in` transforms (NTS-449) on
    // the provided values first: user value -> stored form, before the
    // guards and validation. The required-property refill below re-reads
    // stored values, which are never transformed again.
    const provided = { ...properties }

    await applyEmbeddings(schema, provided)
    await applyInTransforms(schema, provided)

    // Stored derived properties (NTS-569): the patch alone rarely carries
    // every source, so compute runs over the entity's stored values under
    // the transformed patch — a stored-domain record. The compute output is
    // already stored-form (no second transform), and cypher-side sets are
    // appended after the SET clause below. The stored side never
    // contributes the derived key itself: the instance's stale value must
    // not count as an explicit win — only a patch on the key does.
    const writtenKeys = new Set(
      Object.keys(properties).filter((key) => properties[key] !== undefined),
    )

    const derivedKeys = new Set(
      schema
        .getProperties()
        .filter((property) => property.getDerived() !== undefined)
        .map((property) => property.getKey()),
    )

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
            // @CreatedAt is set once on create (NTS-165)
            property.isCreatedAt() ||
            // @Version is library-managed (NTS-158)
            property.isVersion() ||
            isProjectedProperty(property) ||
            NON_VALUE_TYPES.has(property.getType()),
        )
        .map((property) => property.getKey()),
    )

    for (const relationship of schema.getRelationships()) {
      guarded.add(relationship.getKey())
    }

    // NTS-597: the derive input's stored domain is the DATABASE row, not
    // the in-memory entity — a partially hydrated instance (a stub) carries
    // stale or missing source values, and the compute would derive from
    // them. Cypher-side derivations need no stored state (the database
    // evaluates their expressions); compute-side ones need every source,
    // so a trigger among the written keys forces the read. The same read
    // feeds the required-property refill below — one round trip over the
    // node's current state instead of a second, later one.
    const isDeriveInputNeeded = [...derivedKeys].some((key) => {
      if (writtenKeys.has(key)) {
        return false
      }

      const derived = schema.getProperty(key).getDerived()

      if (derived === undefined || typeof derived.compute !== 'function') {
        return false
      }

      const sources = Array.isArray(derived.from) ? derived.from : []

      return sources.some((source) => writtenKeys.has(source))
    })

    const isRefillPossible = schema.getProperties().some((property) => {
      if (!property.isRequired()) {
        return false
      }

      const key = property.getKey()

      return provided[key] === undefined || provided[key] === null || guarded.has(key)
    })

    const node =
      isDeriveInputNeeded || isRefillPossible
        ? await this.readNode(schema, identityCriteria)
        : undefined

    const storedUnder: Record<string, unknown> = {}

    if (node !== undefined) {
      for (const property of schema.getProperties()) {
        const key = property.getKey()

        // The stored side never contributes the derived key itself: the
        // stored value must not count as an explicit win — only a patch
        // on the key does
        const value = node.properties[key]

        if (value !== undefined && !derivedKeys.has(key)) {
          storedUnder[key] = value
        }
      }
    }

    const derivedInput = { ...storedUnder, ...provided }
    const derived = deriveProperties(schema, derivedInput, writtenKeys)

    for (const key of derived.recomputed) {
      provided[key] = derivedInput[key]
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

    // NTS-597: the same DB-state read that fed the derive — the separate
    // late read is gone
    for (const property of refill) {
      const stored = node?.properties[property.getKey()]

      if (stored !== undefined && stored !== null) {
        set[property.getKey()] = stored
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

    // Optimistic locking (NTS-158): an instance carrying the version it was
    // hydrated with guards the write on it — zero matched rows means the
    // node changed (or vanished) under another transaction
    const version = versionProperty(schema)
    const versionKey = version?.getKey()
    const expectedVersion: unknown =
      versionKey === undefined ? undefined : Reflect.get(entity, versionKey)
    const isLockGuarded = typeof expectedVersion === 'number'

    if (version !== undefined && versionKey !== undefined) {
      if (isLockGuarded) {
        builder.param('expectedVersion', expectedVersion)
        builder.whereRaw(`${THIS_NODE}.${versionKey} = $expectedVersion`)
      }

      // Every real update write bumps the version by exactly 1
      builder.setExpr(`${THIS_NODE}.${versionKey}`, versionBump(THIS_NODE, versionKey))
    }

    // Conditional update (NTS-688): the guard composes with the version
    // check — zero matched rows means the guard failed (or the node
    // vanished), and the version-guarded case still reports the conflict
    // as OptimisticLockError
    if (guard !== undefined) {
      if (guard.params !== undefined) {
        for (const [key, value] of Object.entries(guard.params)) {
          builder.param(key, value)
        }
      }

      builder.whereRaw(guard.where)
    }

    if (Object.keys(plain).length > 0) {
      builder.set(THIS_NODE, plain, '+=')
    }

    for (const property of vectorProperties) {
      builder.setVectorProperty(THIS_NODE, property.getKey(), set[property.getKey()])
    }

    // Cypher-side derived properties (NTS-569): evaluated by the database
    // after the patch is applied, so the expressions read the new values
    for (const { key, cypher } of derived.cypherSets) {
      builder.setExpr(`${THIS_NODE}.${quote(key)}`, cypher)
    }

    // Server-side updatedAt stamp on every write (NTS-165) — an explicit
    // value in `set` wins, and the nothing-to-write early return above
    // leaves a no-op update's stamp alone too
    const updatedAt = timestampProperty(schema, 'updatedAt')

    if (updatedAt !== undefined && set[updatedAt.getKey()] === undefined) {
      builder.setExpr(`${THIS_NODE}.${updatedAt.getKey()}`, stampExpression(updatedAt))
    }

    builder.return(THIS_NODE, `elementId(${THIS_NODE}) AS ${INTERNAL_ID}`)

    const { query, params } = builder.build()

    const output = await this.runner.run(query, params)

    if (isLockGuarded && output.records.length === 0) {
      throw new OptimisticLockError(schema.getLabels().join(':'))
    }

    return output
  }
}
