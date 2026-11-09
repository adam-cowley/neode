import type { EventEmitter } from 'node:events'
import type {
  GraphRelationship,
  HydrateQueryOptions,
  QueryOutput,
  QueryParams as QueryParameters,
  Runner,
  TransactionHandle,
} from '../driver/types.js'
import { EventType } from '../common/events.js'
import { diffDirty } from '../dirty.js'
import { getModel, getModels } from '../meta/index.js'
import { EntitySchema } from '../meta/entity/entity-schema.js'
import type { EntitySchema as EntitySchemaType } from '../meta/entity/entity-schema.js'
import { elementIdOfEntity } from '../element-id.js'
import type { RelationshipPropertySchema } from '../meta/relationship-property-schema.js'
import type { INeode } from '../neode.interface.js'
import type { Builder } from '../query/index.js'
import type { ReadOptions, WithSpec } from '../query/load-spec.js'
import { BoundBuilder } from '../query/bound-builder.js'
import { NeodeError } from '../errors/index.js'
import { DeleteService, type DeleteOptions } from '../services/query/delete.service.js'
import { DetachService, type DetachResult } from '../services/query/detach.service.js'
import { FindByIdService } from '../services/query/find-by-id.service.js'
import { WITHOUT_ALL_FILTERS } from '../services/query/filters.js'
import { FindService } from '../services/query/find.service.js'
import { GetService, type OrderSpec } from '../services/query/get.service.js'
import { MergeService, getMergeFields } from '../services/query/merge.service.js'
import { ProjectionService } from '../projection/projection.service.js'
import { INTERNAL_ID } from '../constants.js'
import { RelateService } from '../services/query/relate.service.js'
import { UpdateService } from '../services/query/update.service.js'
import { WithinDistanceService } from '../services/query/within-distance.service.js'
import { search, type ScoredEntity } from '../services/query/search.service.js'
import { runObservers } from '../observers.js'
import { isConstructorOf, isRecord } from '../services/type-guards.js'
import { hydrate, hydrateWhenRequested, splitHydrateArguments } from '../hydrate.js'

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

  constructor(handle: TransactionHandle, eventEmitter: EventEmitter) {
    this.handle = handle
    this.eventEmitter = eventEmitter
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

    await this.handle.commit()

    this.state = 'committed'
  }

  /**
  Roll the transaction back. Rolling back an already-settled scope (committed
  or rolled back) is a no-op — there is nothing left to roll back.
  */
  async rollback(): Promise<void> {
    if (this.state !== 'open') {
      return
    }

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
    databaseOrOptions?: string | ReadOptions<T>,
  ): Promise<T | undefined> {
    this.ignoreDatabaseOverride(
      typeof databaseOrOptions === 'string' ? databaseOrOptions : databaseOrOptions?.database,
    )

    const schema = this.getSchema(constructor)

    const options = typeof databaseOrOptions === 'object' ? databaseOrOptions : undefined
    const withSpec = options?.with

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

    const filters =
      typeof databaseOrOptions === 'object' && databaseOrOptions.withoutFilters !== undefined
        ? { withoutFilters: databaseOrOptions.withoutFilters }
        : undefined

    const service = new GetService(this.handle)

    return service.get<T>(constructor, schema, parameters, limit, skip, undefined, filters)
  }

  async getFirst<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters: Record<string, unknown>,
    database?: string,
  ): Promise<T | undefined> {
    const records = await this.get<T>(constructor, parameters, 1, 0, database)

    return records[0]
  }

  async save<T>(entity: T, database?: string): Promise<T> {
    this.ignoreDatabaseOverride(database)

    if (!isRecord(entity)) {
      throw new TypeError('save requires an entity object')
    }

    const schema = this.getSchema(entity.constructor)

    // NTS-511: beforeSave runs before the dirty diff — mutations count
    await runObservers(entity.constructor, 'beforeSave', entity, {
      isNew: false,
      database: undefined,
    })

    const merge = new MergeService(this.handle)

    // NTS-157: tracked (hydrated) instances write only their dirty
    // scalar properties — relationships stay on the explicit
    // relate()/detach() paths. The facade's clean no-op short-circuit
    // cannot apply inside an open transaction (the re-find still runs to
    // hand back the persisted state), so only the dirty filter threads
    // through.
    const dirtyKeys = diffDirty(schema, entity)

    const { elementId, created } = await merge.save(
      entity,
      schema,
      dirtyKeys.length > 0 ? new Set(dirtyKeys) : undefined,
    )

    const constructor: unknown = entity.constructor

    if (!isConstructorOf<T>(constructor)) {
      throw new TypeError('The saved entity has no model constructor')
    }

    // Write-path re-hydration bypasses the read filters (WITHOUT_ALL_FILTERS)
    const saved = await new FindByIdService(this.handle).find<T>(constructor, schema, elementId, {
      withoutFilters: [WITHOUT_ALL_FILTERS],
    })

    if (saved === undefined) {
      throw new NeodeError('Entity was saved but could not be found immediately afterwards')
    }

    // Emit the event the merge actually was: a create or an update
    this.eventEmitter.emit(created ? EventType.NODE_CREATED : EventType.NODE_UPDATED, saved)

    await runObservers(entity.constructor, 'afterSave', saved, {
      isNew: created,
      database: undefined,
    })

    return saved
  }

  /**
  MERGE a node of the given constructor on its merge fields (the unique
  and indexed properties present in `properties` form the match,
  everything else is set) — mirror of the facade's merge, in this
  transaction's scope
  */
  async merge<T>(
    constructor: new (...arguments_: never[]) => T,
    properties: Record<string, unknown> = {},
    database?: string,
  ): Promise<T | undefined> {
    this.ignoreDatabaseOverride(database)

    const schema = this.getSchema(constructor)

    // Entity instances (or arrays of them) in the properties mean
    // relationship writes — those go through the save() path, which
    // already creates/relates nested relationships (facade parity)
    const hasRelationshipValues = schema.getRelationships().some((relationship) => {
      const value = properties[relationship.getKey()]

      if (value === undefined || value === null) {
        return false
      }

      return Array.isArray(value) ? value.length > 0 : typeof value === 'object'
    })

    if (hasRelationshipValues) {
      const constructed = new constructor()

      if (!isRecord(constructed)) {
        throw new NeodeError('The model constructor did not produce an entity object')
      }

      Object.assign(constructed, properties)

      return this.save(constructed)
    }

    const mergeKeys = new Set(getMergeFields(schema).map((property) => property.getKey()))
    const entries = Object.entries(properties)

    const match = Object.fromEntries(entries.filter(([key]) => mergeKeys.has(key)))
    const set = Object.fromEntries(entries.filter(([key]) => !mergeKeys.has(key)))

    const output = await new MergeService(this.handle).mergeOn(schema, match, set)

    const firstRecord = output.records[0]

    if (firstRecord === undefined) {
      throw new NeodeError('mergeOn returned no records')
    }

    const elementId = firstRecord.get(INTERNAL_ID)

    if (typeof elementId !== 'string') {
      throw new NeodeError('mergeOn did not return an elementId')
    }

    return new FindByIdService(this.handle).find<T>(constructor, schema, elementId, {
      withoutFilters: [WITHOUT_ALL_FILTERS],
    })
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

    // NTS-511: beforeDelete can fail the delete (tx rolls back)
    await runObservers(entity.constructor, 'beforeDelete', entity, {
      isNew: false,
      database: undefined,
    })

    const service = new DeleteService(this.handle)

    await service.delete(schema, entity, typeof options === 'string' ? undefined : options)

    // Emit event
    this.eventEmitter.emit(EventType.NODE_DELETED, entity)

    await runObservers(entity.constructor, 'afterDelete', entity, {
      isNew: false,
      database: undefined,
    })
  }

  /**
  UPDATE the given properties on a node (`+=` semantics), then
  re-hydrate it — mirror of the facade's update
  */
  async update<T>(
    entity: T,
    properties: Record<string, unknown> = {},
    database?: string,
  ): Promise<T | undefined> {
    this.ignoreDatabaseOverride(database)

    if (!isRecord(entity)) {
      throw new TypeError('update requires an entity object')
    }

    const schema = this.getSchema(entity.constructor)

    await new UpdateService(this.handle).update(schema, entity, properties)

    const elementId = elementIdOfEntity(schema, entity)

    if (elementId === undefined) {
      return undefined
    }

    const constructor: unknown = entity.constructor

    if (!isConstructorOf<T>(constructor)) {
      throw new TypeError('The updated entity has no model constructor')
    }

    return new FindByIdService(this.handle).find<T>(constructor, schema, elementId, {
      withoutFilters: [WITHOUT_ALL_FILTERS],
    })
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
      this.eventEmitter.emit(
        isForceCreate ? EventType.RELATIONSHIP_CREATED : EventType.RELATIONSHIP_MERGED,
        result,
      )
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
  ALL nodes of the given constructor, optionally filtered, ordered,
  limited and skipped — mirror of the facade's all
  */
  async all<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters: Record<string, unknown> = {},
    order?: OrderSpec,
    limit?: number,
    skip?: number,
    database?: string,
    options?: { with?: WithSpec<T>; withoutFilters?: string[] | undefined },
  ): Promise<T[]> {
    this.ignoreDatabaseOverride(database)

    const schema = this.getSchema(constructor)

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
  ): Promise<ScoredEntity<T>[]> {
    return search<T>(this.handle, constructor, indexName, query, limit, filters)
  }

  /**
  Nodes of the given constructor within `distance` of the given point —
  mirror of the facade's withinDistance
  */
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
  ): Promise<T[]> {
    this.ignoreDatabaseOverride(database)

    const schema = this.getSchema(constructor)

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

  async cypher<T>(
    query: string,
    parameters?: QueryParameters,
    options?: { hydrate: new (...arguments_: never[]) => T; alias?: string },
  ): Promise<T[]>
  async cypher(query: string, parameters?: QueryParameters, options?: object): Promise<QueryOutput>
  async cypher(
    query: string,
    parameters: QueryParameters = {},
    options: { hydrate?: new (...arguments_: never[]) => unknown; alias?: string } = {},
  ): Promise<QueryOutput | unknown[]> {
    const output: QueryOutput = await this.handle.run(query, parameters)

    return options.hydrate ? hydrate(options.hydrate, output, options.alias ?? 'this') : output
  }
}
