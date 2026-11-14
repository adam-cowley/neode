import type { EventEmitter } from 'node:events'
import type {
  ConnectionProvider,
  GraphRelationship,
  HydrateQueryOptions,
  QueryOutput,
  QueryParams as QueryParameters,
  QuerySummary,
  Runner,
  TransactionHandle,
} from '../driver/types.js'
import { EventType } from '../common/events.js'
import { diffDirty } from '../dirty.js'
import { getModel, getModels } from '../meta/index.js'
import { EntitySchema } from '../meta/entity/entity-schema.js'
import type { EntitySchema as EntitySchemaType } from '../meta/entity/entity-schema.js'
import { elementIdOfEntity } from '../element-id.js'
import type { Newable } from '../meta/newable.js'
import type { RelationshipPropertySchema } from '../meta/relationship-property-schema.js'
import type { INeode } from '../neode.interface.js'
import type { Builder } from '../query/index.js'
import type { LoadedEntity, QueryLoadSpec, ReadOptions, WithSpec } from '../query/load-spec.js'
import type { WhereFilter, WhereFilterLevel } from '../query/where-filter.js'
import { BoundBuilder } from '../query/bound-builder.js'
import { NeodeError } from '../errors/index.js'
import { DeleteService, type DeleteOptions } from '../services/query/delete.service.js'
import { DetachService, type DetachResult } from '../services/query/detach.service.js'
import {
  type SyncEdgesOptions,
  SyncService,
  type SyncEdgesResult,
} from '../services/query/sync.service.js'
import { FindByIdService } from '../services/query/find-by-id.service.js'
import { assertPublicWithoutFilters } from '../services/query/filters.js'
import { FindService } from '../services/query/find.service.js'
import { GetService, type OrderSpec } from '../services/query/get.service.js'
import {
  mergeOutcome,
  mergeResultFromSave,
  MergeService,
  getMergeFields,
  type MergeResult,
} from '../services/query/merge.service.js'
import { ProjectionService } from '../projection/projection.service.js'
import { INTERNAL_ID } from '../constants.js'
import { RelateService } from '../services/query/relate.service.js'
import {
  ReplaceRelationshipService,
  type ReplaceRelationshipOptions,
} from '../services/query/replace-relationship.service.js'
import { UpdateService, type UpdateGuard } from '../services/query/update.service.js'
import { WithinDistanceService } from '../services/query/within-distance.service.js'
import { search, type ScoredEntity } from '../services/query/search.service.js'
import { knn, type KnnMode } from '../services/query/knn.service.js'
import { globalObservers, type ObserverRegistry } from '../observers.js'
import { EffectBuffer } from './effects.js'
import { isConstructorOf, isRecord } from '../services/type-guards.js'
import { hydrate, hydrateWhenRequested, splitHydrateArguments } from '../hydrate.js'
import { hydrateWrittenNode } from '../services/write-utilities.js'
import { type ParallelBody, type ParallelOptions, runParallel } from './parallel.js'

/**
The INeode surface scoped to one open transaction: every read/write runs
through the TransactionHandle opened by `Neode#beginTransaction` until its
commit/rollback, with the facade's model methods (create, merge, relate,
…) mirrored inside that scope. The close endpoints are safe to sequence:
a second commit() is a no-op and a rollback after a commit does nothing
(the managed scopes commit on success), while a commit after a rollback
throws.
*/
export class TransactionalService implements INeode {
  private readonly handle: TransactionHandle

  private readonly eventEmitter: EventEmitter

  // 'open' until a terminal operation (commit/rollback) succeeded — the managed scopes read it to avoid a double close
  private state: 'open' | 'committed' | 'rolled-back' = 'open'

  // NTS-582: lifecycle events and after* observers queue here and run only once the transaction committed
  private readonly effects: EffectBuffer

  // False when an enclosing unit owns the buffer and flushes it after ITS commit (ambient scopes)
  private readonly shouldFlushOnCommit: boolean

  // NTS-596: the owning Neode instance's observer registry — hooks registered
  // on the instance fire for this scope's writes; the process-global
  // registry (the standalone observe() function) is the default
  private readonly observers: ObserverRegistry

  /**
  The parent connection parallel() (NTS-631) fans the autocommit modes
  out onto — the facade passes its own connection; ambient scopes
  forward the connection their transaction was opened from.
  */
  private readonly parent: ConnectionProvider | undefined

  constructor(
    handle: TransactionHandle,
    eventEmitter: EventEmitter,
    effects: EffectBuffer = new EffectBuffer(),
    shouldFlushOnCommit = true,
    observers: ObserverRegistry = globalObservers,
    parent?: ConnectionProvider,
  ) {
    this.handle = handle
    this.eventEmitter = eventEmitter
    this.effects = effects
    this.shouldFlushOnCommit = shouldFlushOnCommit
    this.observers = observers
    this.parent = parent
  }

  /**
  The schema registered for the given model constructor
  */
  private getSchema(constructor: unknown): EntitySchemaType {
    const found = getModel(constructor)

    if (!(found instanceof EntitySchema)) {
      const constructorName = typeof constructor === 'function' ? constructor.name : ''

      const name = constructorName.length > 0 ? constructorName : 'unknown'

      throw new NeodeError(
        `Couldn't find a model for "${name}". Registered model(s) are: ${Array.from(
          getModels().keys(),
          (model) => (typeof model === 'function' ? model.name : 'unknown'),
        ).join(', ')}`,
      )
    }

    return found
  }

  /**
  The relationship declared on the schema under the given key
  (mirror of the facade's relate-by-key resolution)
  */
  private requireRelationship(schema: EntitySchemaType, key: string): RelationshipPropertySchema {
    if (!schema.hasRelationship(key)) {
      throw new NeodeError(
        `Unknown relationship "${key}" on ${schema.getLabels().join(':') || 'entity'}`,
      )
    }

    return schema.getRelationship(key)
  }

  /**
  The facade-mirror methods accept the per-call `database` argument for
  signature parity; a transaction handle is bound to one database at open
  time, so the argument is acknowledged and ignored
  */
  private ignoreDatabaseOverride(database: string | undefined): void {
    if (database !== undefined) {
      // Deliberately ignored: this transaction runs against the database
      // it was opened with
    }
  }

  /**
  Save plus the write outcome (NTS-630): the created flag the lifecycle
  events report and the root statement's summary — merge()'s
  relationship-values path wraps the same outcome mergeOn() returns.
  */
  private async saveOutcome<T>(
    entity: T,
    database?: string,
  ): Promise<{ saved: T; created: boolean; summary: QuerySummary | undefined }> {
    this.ignoreDatabaseOverride(database)

    if (!isRecord(entity)) {
      throw new TypeError('save requires an entity object')
    }

    const schema = this.getSchema(entity.constructor)

    // NTS-511: beforeSave runs before the dirty diff — mutations count
    await this.observers.run(entity.constructor, 'beforeSave', entity, {
      isNew: false,
      database: undefined,
    })

    const merge = new MergeService(this.handle)

    // NTS-157: tracked (hydrated) instances write only their dirty
    // scalar properties — relationships stay on the explicit
    // relate()/detach() paths. The facade's clean no-op short-circuit
    // cannot apply inside an open transaction (the write itself still
    // runs, handing back the persisted state), so only the dirty filter
    // threads through.
    const dirtyKeys = diffDirty(schema, entity)

    // NTS-633: the merge statement's RETURN carries the written node —
    // hydrate it directly; FindByIdService stays as the fallback
    // (write-path re-hydration bypasses the read filters —
    // WITHOUT_ALL_FILTERS)
    const { elementId, created, summary, output } = await merge.save(
      entity,
      schema,
      dirtyKeys.length > 0 ? new Set(dirtyKeys) : undefined,
    )

    const constructor: unknown = entity.constructor

    if (!isConstructorOf<T>(constructor)) {
      throw new TypeError('The saved entity has no model constructor')
    }

    const saved = await hydrateWrittenNode<T>(constructor, schema, this.handle, output, elementId)

    if (saved === undefined) {
      throw new NeodeError('Entity was saved but could not be found immediately afterwards')
    }

    // Emit the event the merge actually was: a create or an update
    // NTS-582: event + afterSave fire after the transaction commits, never
    // for work that rolls back or is retried
    this.effects.defer(async () => {
      this.eventEmitter.emit(created ? EventType.NODE_CREATED : EventType.NODE_UPDATED, saved)

      await this.observers.run(entity.constructor, 'afterSave', saved, {
        isNew: created,
        database: undefined,
      })
    })

    return { saved, created, summary }
  }

  /**
  The shared body of update() / updateWhere() (NTS-688): the guard, when
  given, renders into the statement as a WHERE predicate and turns a
  zero-row outcome into a clean "not written" result.
  */
  private async updateInternal<T>(
    entity: T,
    properties: Record<string, unknown> = {},
    guard?: UpdateGuard,
    database?: string,
  ): Promise<T | undefined> {
    this.ignoreDatabaseOverride(database)

    if (!isRecord(entity)) {
      throw new TypeError('update requires an entity object')
    }

    const schema = this.getSchema(entity.constructor)

    // NTS-596: beforeSave before the statement — errors fail the write
    await this.observers.run(entity.constructor, 'beforeSave', properties, {
      isNew: false,
      database: undefined,
    })

    // NTS-633: the update statement's RETURN carries the mutated node —
    // hydrate it directly; FindByIdService stays as the fallback
    // (write-path re-hydration bypasses the read filters —
    // WITHOUT_ALL_FILTERS)
    const output = await new UpdateService(this.handle).update(schema, entity, properties, guard)

    const elementId = elementIdOfEntity(schema, entity)

    const constructor: unknown = entity.constructor

    if (!isConstructorOf<T>(constructor)) {
      throw new TypeError('The updated entity has no model constructor')
    }

    const saved = await hydrateWrittenNode<T>(constructor, schema, this.handle, output, elementId)

    // NTS-688: a guarded update that matched zero rows wrote nothing —
    // resolve undefined instead of the hydration fallback re-reading the
    // unchanged node
    if (guard !== undefined && output.records.length === 0) {
      return undefined
    }

    if (saved !== undefined) {
      // NTS-582: event + afterSave fire after the transaction commits
      this.effects.defer(async () => {
        this.eventEmitter.emit(EventType.NODE_UPDATED, saved)

        await this.observers.run(constructor, 'afterSave', saved, {
          isNew: false,
          database: undefined,
        })
      })
    }

    return saved
  }

  getRunner(): Runner {
    return this.handle
  }

  getTransaction(): TransactionHandle {
    return this.handle
  }

  /**
  Commit the transaction. A second commit is a no-op (the managed scopes —
  `Neode#inReadTransaction` / `Neode#inWriteTransaction` — commit on success,
  so an explicit commit inside the work is optional); committing after a
  rollback throws.
  */
  async commit(): Promise<void> {
    if (this.state === 'committed') {
      return
    }

    if (this.state === 'rolled-back') {
      throw new NeodeError(
        'This transaction was already rolled back and cannot be committed — begin a new transaction.',
      )
    }

    try {
      await this.handle.commit()
    } catch (error) {
      // A failed commit is ambiguous at best — never release its events
      this.effects.discard()

      throw error
    }

    this.state = 'committed'

    // Committed: the events and after* observers the writes queued fire now
    if (this.shouldFlushOnCommit) {
      await this.effects.flush()
    }
  }

  /**
  Roll the transaction back. Rolling back an already-settled scope (committed
  or rolled back) is a no-op — there is nothing left to roll back.
  */
  async rollback(): Promise<void> {
    if (this.state !== 'open') {
      return
    }

    // Whatever the rollback's outcome, the buffered work never committed
    this.effects.discard()

    await this.handle.rollback()

    this.state = 'rolled-back'
  }

  /**
  True once a terminal operation (commit or rollback) has succeeded on this
  scope
  */
  isSettled(): boolean {
    return this.state !== 'open'
  }

  /**
  The facade's parallel() from inside a transaction scope (NTS-631):

  - 'read' / 'write' — the autocommit modes delegate through the PARENT
    connection (fresh sessions). They deliberately run OUTSIDE this
    transaction — a transaction cannot fan out into more transactions,
    and joining this scope would serialise every statement again — so
    these operations do NOT see this transaction's uncommitted writes.
  - 'atomic' — REJECTED with a descriptive error: a scoped transaction
    cannot fan out into more transactions. Use the facade's parallel()
    for atomic fan-out across sessions, or run the writes sequentially
    on this scope.

  Results mirror the input shape (map → map, array → array); failures
  throw ParallelError aligned with the input.
  */
  parallel<Operations extends Record<string, ParallelBody<unknown>>>(
    operations: Operations,
    options?: ParallelOptions,
  ): Promise<{ [Key in keyof Operations]: Awaited<ReturnType<Operations[Key]>> }>
  parallel<T>(operations: ParallelBody<T>[], options?: ParallelOptions): Promise<T[]>
  async parallel(
    operations: Record<string, ParallelBody<unknown>> | ParallelBody<unknown>[],
    options: ParallelOptions = {},
  ): Promise<Record<string, unknown> | unknown[]> {
    if (options.mode === 'atomic') {
      throw new NeodeError(
        'parallel() with mode "atomic" cannot run inside a transaction scope — a scoped transaction ' +
          "cannot fan out into more transactions. Use the facade's parallel() for atomic fan-out " +
          'across sessions, or run the writes sequentially on this scope.',
      )
    }

    if (this.parent === undefined) {
      throw new NeodeError(
        "This transaction scope has no parent connection to fan out onto — call the facade's " +
          'parallel() instead.',
      )
    }

    return runParallel(this.parent, operations, options)
  }

  /**
  True once the transaction committed (as opposed to rolled back or still open)
  */
  isCommitted(): boolean {
    return this.state === 'committed'
  }

  /**
  Map-narrowed load spec (NTS-154, facade parity): `options.with` checked
  against the model's type-level relationship map — the resolved entity's
  type carries every requested relationship.
  */
  async find<C extends Newable, const WithSpecT extends QueryLoadSpec<C>>(
    constructor: C,
    value: string | number,
    options: {
      with: WithSpecT
      database?: string | undefined
      withoutFilters?: string[] | undefined
    },
  ): Promise<LoadedEntity<InstanceType<C>, WithSpecT> | undefined>
  async find<T>(
    constructor: new (...arguments_: never[]) => T,
    value: string | number,
    database?: string,
  ): Promise<T | undefined>
  async find<T>(
    constructor: new (...arguments_: never[]) => T,
    value: string | number,
    options: ReadOptions<T>,
  ): Promise<T | undefined>
  async find<T>(
    constructor: new (...arguments_: never[]) => T,
    value: string | number,
    databaseOrOptions?:
      | string
      | {
          with?: object
          database?: string | undefined
          withoutFilters?: string[] | undefined
        },
  ): Promise<unknown> {
    this.ignoreDatabaseOverride(
      typeof databaseOrOptions === 'string' ? databaseOrOptions : databaseOrOptions?.database,
    )

    const schema = this.getSchema(constructor)

    const options = typeof databaseOrOptions === 'object' ? databaseOrOptions : undefined
    const withSpec = options?.with

    assertPublicWithoutFilters(options?.withoutFilters)

    // NTS-568: withoutFilters plumbs through with the facade's semantics —
    // each name disables only its own filter (per-name independence)
    const filters =
      options?.withoutFilters === undefined ? undefined : { withoutFilters: options.withoutFilters }

    // A load spec reads through the projection path (facade parity)
    return withSpec === undefined
      ? new FindService(this.handle).find<T>(constructor, schema, value, filters)
      : new ProjectionService(this.handle).find<T>(constructor, schema, value, withSpec, filters)
  }

  async findById<T>(
    constructor: new (...arguments_: never[]) => T,
    id: string,
    database?: string,
  ): Promise<T | undefined> {
    this.ignoreDatabaseOverride(database)

    const schema = this.getSchema(constructor)

    const service = new FindByIdService(this.handle)

    return service.find<T>(constructor, schema, id)
  }

  async get<C extends Newable>(
    constructor: C,
    parameters: WhereFilter<C>,
    limit?: number,
    skip?: number,
    databaseOrOptions?: string | { withoutFilters?: string[] | undefined },
  ): Promise<InstanceType<C>[]>
  async get<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters: Record<string, unknown>,
    limit?: number,
    skip?: number,
    databaseOrOptions?: string | { withoutFilters?: string[] | undefined },
  ): Promise<T[]> {
    this.ignoreDatabaseOverride(
      typeof databaseOrOptions === 'string' ? databaseOrOptions : undefined,
    )

    const schema = this.getSchema(constructor)

    assertPublicWithoutFilters(
      typeof databaseOrOptions === 'object' ? databaseOrOptions.withoutFilters : undefined,
    )

    const filters =
      typeof databaseOrOptions === 'object' && databaseOrOptions.withoutFilters !== undefined
        ? { withoutFilters: databaseOrOptions.withoutFilters }
        : undefined

    const service = new GetService(this.handle)

    return service.get<T>(constructor, schema, parameters, limit, skip, undefined, filters)
  }

  async getFirst<C extends Newable>(
    constructor: C,
    parameters: WhereFilter<C>,
    database?: string,
  ): Promise<InstanceType<C> | undefined>
  async getFirst(
    constructor: Newable,
    parameters: Record<string, unknown>,
    database?: string,
  ): Promise<unknown> {
    const records = await this.get(constructor, parameters, 1, 0, database)

    return records[0]
  }

  async save<T>(entity: T, database?: string): Promise<T> {
    const outcome = await this.saveOutcome(entity, database)

    return outcome.saved
  }

  /**
  MERGE a node of the given constructor on its merge fields (the unique
  and indexed properties present in `properties` form the match,
  everything else is set) — mirror of the facade's merge, in this
  transaction's scope. Resolves to the same merge outcome mergeOn()
  returns (NTS-630)
  */
  async merge<T>(
    constructor: new (...arguments_: never[]) => T,
    properties: Record<string, unknown> = {},
    database?: string,
  ): Promise<MergeResult<T> | undefined> {
    this.ignoreDatabaseOverride(database)

    const schema = this.getSchema(constructor)

    // Relationship values (or arrays of them) in the properties mean
    // relationship writes — those go through the save() path, which
    // already creates/relates nested relationships (facade parity).
    // NTS-627: primary-key values are relationship writes too — they
    // route through save() like entity instances.
    const hasRelationshipValues = schema.getRelationships().some((relationship) => {
      const value = properties[relationship.getKey()]

      return value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0)
    })

    if (hasRelationshipValues) {
      const constructed = new constructor()

      if (!isRecord(constructed)) {
        throw new NeodeError('The model constructor did not produce an entity object')
      }

      Object.assign(constructed, properties)

      const { saved, created, summary } = await this.saveOutcome(constructed)

      return mergeResultFromSave(saved, created, summary)
    }

    const mergeKeys = new Set(getMergeFields(schema).map((property) => property.getKey()))
    const entries = Object.entries(properties)

    return this.mergeOn<T>(
      constructor,
      Object.fromEntries(entries.filter(([key]) => mergeKeys.has(key))),
      Object.fromEntries(entries.filter(([key]) => !mergeKeys.has(key))),
      database,
    )
  }

  /**
  MERGE a node on the given match properties, then set the given
  properties — NTS-630: resolves to the merge outcome (the hydrated
  entity plus created/updated flags, counters and the raw driver
  summary), mirroring the facade's mergeOn in this transaction's scope
  */
  async mergeOn<T>(
    constructor: new (...arguments_: never[]) => T,
    match: Record<string, unknown>,
    set: Record<string, unknown> = {},
    database?: string,
  ): Promise<MergeResult<T> | undefined> {
    this.ignoreDatabaseOverride(database)

    const schema = this.getSchema(constructor)

    // NTS-596: beforeSave receives the set record (facade mergeOn parity —
    // the mutable record of what the write sets). Errors fail the write.
    await this.observers.run(constructor, 'beforeSave', set, {
      isNew: false,
      database: undefined,
    })

    const output = await new MergeService(this.handle).mergeOn(schema, match, set)

    const firstRecord = output.records[0]

    if (firstRecord === undefined) {
      throw new NeodeError('mergeOn returned no records')
    }

    const elementId = firstRecord.get(INTERNAL_ID)

    if (typeof elementId !== 'string') {
      throw new NeodeError('mergeOn did not return an elementId')
    }

    // NTS-633: the MERGE statement's RETURN carries the merged node —
    // hydrate it directly; FindByIdService stays as the fallback
    // (write-path re-hydration bypasses the read filters —
    // WITHOUT_ALL_FILTERS)
    const merged = await hydrateWrittenNode<T>(constructor, schema, this.handle, output, elementId)

    if (merged !== undefined) {
      // NTS-582: fires after the transaction commits (NTS-596: NODE_MERGED
      // is the merge path's event, facade mergeOn parity)
      this.effects.defer(async () => {
        this.eventEmitter.emit(EventType.NODE_MERGED, merged)

        await this.observers.run(constructor, 'afterSave', merged, {
          isNew: false,
          database: undefined,
        })
      })
    }

    return merged === undefined
      ? undefined
      : { entity: merged, ...mergeOutcome(output.summary), summary: output.summary }
  }

  /**
  Delete a node in this transaction's scope. `options` threads the
  cascade modes through; the legacy string second argument (database)
  stays accepted, as on the facade.
  */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the generic mirrors INeode#delete's signature; the entity type cannot be inferred from anything else in it
  async delete<T>(entity: T, options?: DeleteOptions | string, database?: string): Promise<void> {
    this.ignoreDatabaseOverride(database)

    if (!isRecord(entity)) {
      throw new TypeError('delete requires an entity object')
    }

    const schema = this.getSchema(entity.constructor)

    // Soft deletes are not deletions (the node survives): the label write
    // is an update, so NODE_UPDATED fires instead of NODE_DELETED — the
    // facade's delete() semantics (NTS-596)
    const cascadeOptions: DeleteOptions | undefined =
      typeof options === 'string' ? undefined : options

    const isSoft =
      cascadeOptions?.force !== true &&
      (schema.getSoftDelete() !== undefined ||
        (cascadeOptions?.soft !== undefined && cascadeOptions.soft !== ''))

    // NTS-511: beforeDelete can fail the delete (tx rolls back)
    await this.observers.run(entity.constructor, 'beforeDelete', entity, {
      isNew: false,
      database: undefined,
    })

    const service = new DeleteService(this.handle)

    await service.delete(schema, entity, typeof options === 'string' ? undefined : options)

    // NTS-582: event + afterDelete fire after the transaction commits.
    // Event BEFORE the after* observer: a hook error never suppresses the
    // emission (NTS-596)
    this.effects.defer(async () => {
      if (isSoft) {
        this.eventEmitter.emit(EventType.NODE_UPDATED, entity)
      } else {
        this.eventEmitter.emit(EventType.NODE_DELETED, entity)
      }

      await this.observers.run(entity.constructor, 'afterDelete', entity, {
        isNew: false,
        database: undefined,
      })
    })
  }

  /**
  UPDATE the given properties on a node (`+=` semantics), then
  re-hydrate it — mirror of the facade's update. NTS-596: beforeSave runs
  before the statement, and NODE_UPDATED + afterSave fire after the
  transaction commits (isNew is false: an update never creates).
  */
  async update<T>(
    entity: T,
    properties: Record<string, unknown> = {},
    database?: string,
  ): Promise<T | undefined> {
    return await this.updateInternal(entity, properties, undefined, database)
  }

  /**
  UPDATE the given properties only when a guard predicate holds on the
  matched node (NTS-688) — mirror of the facade's updateWhere. The guard is
  trusted-input Cypher referencing the node as `this`; resolves `undefined`
  when it failed (zero matched rows), with no lifecycle events, and a stale
  @Version still throws `OptimisticLockError`.
  */
  async updateWhere<T>(
    entity: T,
    guard: UpdateGuard,
    properties: Record<string, unknown> = {},
  ): Promise<T | undefined> {
    return await this.updateInternal(entity, properties, guard)
  }

  /**
  Relate two saved nodes by the relationship's KEY on the from-entity's
  schema — mirror of the facade's relate
  */
  async relate<From extends object>(
    constructor: new (...arguments_: never[]) => From,
    from: From,
    to: object,
    relationshipKey: string,
    properties: Record<string, unknown> = {},
    isForceCreate = false,
  ): Promise<GraphRelationship | undefined> {
    const schema = this.getSchema(constructor)

    const relationship = this.requireRelationship(schema, relationshipKey)

    const result = await new RelateService(this.handle).relate(
      schema,
      from,
      to,
      relationship,
      properties,
      isForceCreate,
    )

    if (result !== undefined) {
      // NTS-582: fires after the transaction commits
      this.effects.defer(() => {
        this.eventEmitter.emit(
          isForceCreate ? EventType.RELATIONSHIP_CREATED : EventType.RELATIONSHIP_MERGED,
          result,
        )
      })
    }

    return result
  }

  /**
  Remove the relationship of the given key between two nodes and return
  both re-hydrated — mirror of the facade's detach
  */
  async detach<From extends object, To extends object>(
    constructor: new (...arguments_: never[]) => From,
    from: From,
    to: To,
    relationshipKey: string,
  ): Promise<DetachResult<From, To>> {
    const schema = this.getSchema(constructor)

    const relationship = this.requireRelationship(schema, relationshipKey)

    return new DetachService(this.handle).detach(schema, from, to, relationship)
  }

  /**
  Replace every edge of ONE declared relationship on a node in one
  statement — mirror of the facade's replaceRelationship (NTS-634)
  */
  async replaceRelationship(
    entity: object,
    key: string,
    targets: unknown[],
    properties: Record<string, unknown> = {},
    options?: ReplaceRelationshipOptions,
  ): Promise<void> {
    if (!isRecord(entity)) {
      throw new TypeError('replaceRelationship requires an entity object')
    }

    const schema = this.getSchema(entity.constructor)

    const relationship = this.requireRelationship(schema, key)

    await new ReplaceRelationshipService(this.handle).replaceRelationship(
      schema,
      entity,
      relationship,
      targets,
      properties,
      options,
    )
  }

  /**
  Set the properties of ONE declared relationship's edge (NTS-628) —
  mirror of the facade's updateEdgeProperties: MERGEs the edge (never
  duplicating it) and SETs the properties, idempotent per re-run.
  */
  async updateEdgeProperties(
    entity: object,
    key: string,
    target: object,
    properties: Record<string, unknown> = {},
  ): Promise<GraphRelationship | undefined> {
    const schema = this.getSchema(entity.constructor)

    const relationship = this.requireRelationship(schema, key)

    return new RelateService(this.handle).updateEdgeProperties(
      schema,
      entity,
      relationship,
      target,
      properties,
    )
  }

  /**
  Diff-and-apply a relationship's edges to an EXACT target set (NTS-161,
  Eloquent `sync` precedent) — mirror of the facade's syncEdges
  */
  async syncEdges<From extends object>(
    constructor: new (...arguments_: never[]) => From,
    from: From,
    relationshipKey: string,
    targets: object[],
    options: SyncEdgesOptions = {},
  ): Promise<SyncEdgesResult> {
    const schema = this.getSchema(constructor)

    const relationship = this.requireRelationship(schema, relationshipKey)

    return new SyncService(this.handle).sync(schema, from, relationship, targets, options)
  }

  /**
  ALL nodes of the given constructor, optionally filtered, ordered,
  limited and skipped — mirror of the facade's all
  */
  /**
  Map-narrowed load spec (NTS-154, facade parity): `options.with` checked
  against the model's type-level relationship map — every entity's type
  carries the requested relationships.
  */
  async all<C extends Newable, const WithSpecT extends QueryLoadSpec<C> = never>(
    constructor: C,
    parameters?: WhereFilter<C>,
    order?: OrderSpec,
    limit?: number,
    skip?: number,
    database?: string,
    options?: { with: WithSpecT; withoutFilters?: string[] | undefined },
  ): Promise<LoadedEntity<InstanceType<C>, WithSpecT>[]>
  async all<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters?: WhereFilterLevel<T>,
    order?: OrderSpec,
    limit?: number,
    skip?: number,
    database?: string,
    options?: { with?: WithSpec<T>; withoutFilters?: string[] | undefined },
  ): Promise<T[]>
  async all<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters: Record<string, unknown> = {},
    order?: OrderSpec,
    limit?: number,
    skip?: number,
    database?: string,
    options?: {
      with?: object
      withoutFilters?: string[] | undefined
    },
  ): Promise<unknown> {
    this.ignoreDatabaseOverride(database)

    const schema = this.getSchema(constructor)

    assertPublicWithoutFilters(options?.withoutFilters)

    const withSpec = options?.with

    // NTS-568: withoutFilters plumbs through with the facade's semantics
    const filters =
      options?.withoutFilters === undefined ? undefined : { withoutFilters: options.withoutFilters }

    // A load spec reads through the projection path (facade parity)
    return withSpec === undefined
      ? new GetService(this.handle).get<T>(
          constructor,
          schema,
          parameters,
          limit,
          skip,
          order,
          filters,
        )
      : new ProjectionService(this.handle).get<T>(
          constructor,
          schema,
          parameters,
          limit,
          skip,
          order,
          withSpec,
          filters,
        )
  }

  async search<T>(
    constructor: new (...arguments_: never[]) => T,
    indexName: string,
    query: string,
    limit?: number,
    filters?: { withoutFilters?: string[] | undefined },
    database?: string,
  ): Promise<ScoredEntity<T>[]> {
    this.ignoreDatabaseOverride(database)

    assertPublicWithoutFilters(filters?.withoutFilters)

    return search<T>(this.handle, constructor, indexName, query, limit, filters)
  }

  async knn<T>(
    constructor: new (...arguments_: never[]) => T,
    indexName: string,
    vector: number[],
    k: number,
    mode?: KnnMode,
    filters?: { withoutFilters?: string[] | undefined },
  ): Promise<ScoredEntity<T>[]> {
    assertPublicWithoutFilters(filters?.withoutFilters)

    return knn<T>(this.handle, constructor, indexName, vector, k, mode, filters)
  }

  /**
  Nodes of the given constructor within `distance` of the given point —
  mirror of the facade's withinDistance
  */
  async withinDistance<C extends Newable>(
    constructor: C,
    locationProperty: string,
    point: unknown,
    distance: number,
    parameters?: WhereFilter<C>,
    order?: OrderSpec,
    limit?: number,
    skip?: number,
    database?: string,
    filters?: { withoutFilters?: string[] | undefined },
  ): Promise<InstanceType<C>[]>
  async withinDistance<T>(
    constructor: new (...arguments_: never[]) => T,
    locationProperty: string,
    point: unknown,
    distance: number,
    parameters: Record<string, unknown> = {},
    order?: OrderSpec,
    limit?: number,
    skip?: number,
    database?: string,
    filters?: { withoutFilters?: string[] | undefined },
  ): Promise<T[]> {
    this.ignoreDatabaseOverride(database)

    const schema = this.getSchema(constructor)

    assertPublicWithoutFilters(filters?.withoutFilters)

    return new WithinDistanceService(this.handle).withinDistance<T>(
      constructor,
      schema,
      locationProperty,
      point,
      distance,
      parameters,
      order,
      limit,
      skip,
      filters,
    )
  }

  /**
  Run a query in this transaction's scope
  */
  async readCypher(query: string, parameters: QueryParameters = {}): Promise<QueryOutput> {
    return this.handle.run(query, parameters)
  }

  async writeCypher(query: string, parameters: QueryParameters = {}): Promise<QueryOutput> {
    return this.handle.run(query, parameters)
  }

  /**
  Build-and-run sugar in this transaction's scope (NTS-553): pass a
  Builder to build-and-run it, or a string to pass it straight through
  to readCypher. Caller parameters merge over the builder's own params.

  NTS-559: the `hydrate` option (the options object as the second or
  third argument) hydrates the rows into entities of the given class
  (the same overload `cypher()` offers, in this scope).
  */
  async read<T>(
    query: Builder | string,
    options: { hydrate: new (...arguments_: never[]) => T; alias?: string },
  ): Promise<T[]>
  async read(query: Builder | string, parameters?: QueryParameters): Promise<QueryOutput>
  async read<T>(
    query: Builder | string,
    parameters: QueryParameters | undefined,
    options: { hydrate: new (...arguments_: never[]) => T; alias?: string },
  ): Promise<T[]>
  async read(
    query: Builder | string,
    parametersOrOptions: QueryParameters | HydrateQueryOptions = {},
    options: { hydrate?: new (...arguments_: never[]) => unknown; alias?: string } = {},
  ): Promise<QueryOutput | unknown[]> {
    const { parameters, options: hydrateOptions } = splitHydrateArguments(
      parametersOrOptions,
      options,
    )

    if (typeof query === 'string') {
      const raw = await this.readCypher(query, parameters)

      return hydrateWhenRequested(hydrateOptions, raw)
    }

    const built = query.build()

    const output = await this.readCypher(built.query, { ...built.params, ...parameters })

    return hydrateWhenRequested(hydrateOptions, output)
  }

  /**
  WRITE counterpart of read(), in this transaction's scope.
  */
  async write<T>(
    query: Builder | string,
    options: { hydrate: new (...arguments_: never[]) => T; alias?: string },
  ): Promise<T[]>
  async write(query: Builder | string, parameters?: QueryParameters): Promise<QueryOutput>
  async write<T>(
    query: Builder | string,
    parameters: QueryParameters | undefined,
    options: { hydrate: new (...arguments_: never[]) => T; alias?: string },
  ): Promise<T[]>
  async write(
    query: Builder | string,
    parametersOrOptions: QueryParameters | HydrateQueryOptions = {},
    options: { hydrate?: new (...arguments_: never[]) => unknown; alias?: string } = {},
  ): Promise<QueryOutput | unknown[]> {
    const { parameters, options: hydrateOptions } = splitHydrateArguments(
      parametersOrOptions,
      options,
    )

    if (typeof query === 'string') {
      const raw = await this.writeCypher(query, parameters)

      return hydrateWhenRequested(hydrateOptions, raw)
    }

    const built = query.build()

    const output = await this.writeCypher(built.query, { ...built.params, ...parameters })

    return hydrateWhenRequested(hydrateOptions, output)
  }

  /**
  A Builder bound to this transaction (NTS-554): the fluent surface with
  .read() / .write() terminals, which build-and-run in this transaction's
  scope. A `database` argument is acknowledged for facade parity — a
  transaction handle is bound to one database at open time.
  */
  query(database?: string): BoundBuilder {
    this.ignoreDatabaseOverride(database)

    return new BoundBuilder(this)
  }

  // Raw overload first: the hydrate overload takes priority when listed
  // first and a raw call falls into it as Promise<unknown[]> (NTS-616). The
  // raw options omit `hydrate` so a hydrate object literal falls through to
  // the hydrate overload instead of matching this one.
  async cypher(
    query: string,
    parameters?: QueryParameters,
    options?: { alias?: string },
  ): Promise<QueryOutput>
  async cypher<T>(
    query: string,
    parameters: QueryParameters | undefined,
    options: { alias?: string; hydrate: new (...arguments_: never[]) => T },
  ): Promise<T[]>
  async cypher(
    query: string,
    parameters: QueryParameters = {},
    options: { hydrate?: new (...arguments_: never[]) => unknown; alias?: string } = {},
  ): Promise<QueryOutput | unknown[]> {
    const output: QueryOutput = await this.handle.run(query, parameters)

    return options.hydrate ? hydrate(options.hydrate, output, options.alias ?? 'this') : output
  }
}
