import { EventEmitter } from 'node:events'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
/* eslint-disable unicorn/name-replacements -- "Neo4j" is the product name (the rule's `j` -> `index` replacement misfires on it) */
import path from 'node:path'
import type { Driver } from 'neo4j-driver'
import { EventType, type NeodeEventHandler } from './common/events.js'
import { INTERNAL_ID } from './constants.js'
import { instrumentConnectionProvider } from './driver/instrumented.js'
import { jsonSafeRecord } from './driver/json-safe.js'
import { Neo4jConnectionProvider } from './driver/neo4j-connection-provider.js'
import { RelateConnectionProvider } from './driver/relate.js'
import type {
  AccessMode,
  ConnectionOptions,
  ConnectionProvider,
  CypherOptions,
  GraphRelationship,
  HydrateQueryOptions,
  QueryOutput,
  QueryParams as QueryParameters,
  QueryRecord,
  QuerySummary,
  Runner,
  TransactionHandle,
  TransformedQueryOutput,
} from './driver/types.js'
import { elementIdOfEntity } from './element-id.js'
import { setDefaultNeode } from './entity-methods.js'
import { NeodeError } from './errors/index.js'
import { hydrate, hydrateWhenRequested, mapRecords, splitHydrateArguments } from './hydrate.js'
import { EntitySchema } from './meta/entity/entity-schema.js'
import { getModel, getModels } from './meta/index.js'
import {
  defineModel,
  extendModel,
  getModelByName,
  unknownDefinitionError,
} from './meta/map-schema.js'
import type { Newable } from './meta/newable.js'
import { globalObservers, ObserverRegistry, type ModelObservers } from './observers.js'
import { TraverseBuilder } from './traverse.js'
import { type Ontology, ontology, ontologyMarkdown } from './meta/ontology.js'
import type { RelationshipPropertySchema } from './meta/relationship-property-schema.js'
import { resolveRepository } from './meta/repositories.js'
import type { SchemaDefinition } from './meta/schema-definition.interface.js'
import type { INeode } from './neode.interface.js'
import { type RunCypherScriptOptions, runCypherScript } from './ops/index.js'
import { hasProjectedProperties } from './projection/index.js'
import { ProjectionService } from './projection/projection.service.js'
import { Builder } from './query/index.js'
import { BoundBuilder } from './query/bound-builder.js'
import type {
  LoadedEntity,
  LoadOptions,
  QueryLoadSpec,
  ReadOptions,
  WithSpec,
} from './query/load-spec.js'
import { quote } from './query/quote.js'
import type { Repository } from './repository/index.js'
import { FactoryBuilder } from './services/factory.service.js'
import { assertPublicWithoutFilters, WITHOUT_ALL_FILTERS } from './services/query/filters.js'
import {
  type BulkChunk,
  type BulkOptions,
  BulkService,
  type RowPropertiesResult,
  type RowToPropertiesOptions,
  rowToProperties,
} from './services/query/bulk.service.js'
import { CreateService, type CreateOptions } from './services/query/create.service.js'
import {
  type DeleteOptions,
  DeleteService,
  assertDeleteAllScope,
} from './services/query/delete.service.js'
import { type DetachResult, DetachService } from './services/query/detach.service.js'
import {
  type SyncEdgesOptions,
  type SyncEdgesResult,
  SyncService,
} from './services/query/sync.service.js'
import { diffDirty, isTracked } from './dirty.js'
import { FindService } from './services/query/find.service.js'
import { FindByIdService } from './services/query/find-by-id.service.js'
import { GetService, type OrderSpec } from './services/query/get.service.js'
import { type KnnMode, knn } from './services/query/knn.service.js'
import { LoadRelationService, RelatedQuery } from './services/query/load-relation.service.js'
import {
  getMergeFields,
  mergeOutcome,
  mergeResultFromSave,
  MergeService,
  type MergeResult,
} from './services/query/merge.service.js'
import {
  type ReplaceRelationshipOptions,
  ReplaceRelationshipService,
} from './services/query/replace-relationship.service.js'
import { hydrateWrittenNode } from './services/write-utilities.js'
import { type ParallelBody, type ParallelOptions, runParallel } from './transaction/parallel.js'
import { rollbackAfterFailure } from './transaction/rollback.js'
import {
  type CursorPage,
  type CursorPaginateOptions,
  type FindManyAndCountOptions,
  type ManyAndCount,
  type OffsetPaginateOptions,
  type Page,
  PaginateService,
  type StreamOptions,
} from './services/query/paginate.service.js'
import { RelateService } from './services/query/relate.service.js'
import { type ScoredEntity, search } from './services/query/search.service.js'
import { UpdateService, type UpdateGuard } from './services/query/update.service.js'
import { WithinDistanceService } from './services/query/within-distance.service.js'
import {
  type ApplySchemaDiffOptions,
  applySchemaDrift,
  formatSchemaDrift,
  type SchemaDrift,
  schemaDrift,
} from './services/schema/drift.service.js'
import {
  type FulltextIndexDefinition,
  FulltextIndexService,
} from './services/schema/fulltext.service.js'
import {
  type InspectOptions,
  inspectSchema,
  type SchemaInspection,
} from './services/schema/inspect.service.js'
import { type SchemaResult, SchemaService } from './services/schema/schema.service.js'
import { type VectorIndexDefinition, VectorIndexService } from './services/schema/vector.service.js'
import { generateModels } from './services/schema/generate.service.js'
import type {
  GenerateModelsOptions,
  GenerateModelsResult,
} from './services/schema/generate.service.js'
import {
  GraphTypeService,
  type GraphTypeCreateOptions,
  type GraphTypeConstraintDefinition,
  type GraphTypeDefinition,
} from './services/schema/graph-type.service.js'
import { constructorOf, isConstructorOf, isObjectArray, isRecord } from './services/type-guards.js'
import {
  ambientTransaction,
  runAmbientTransaction,
  type TransactionOptions,
} from './transaction/ambient.js'
import { type BatchStatementError, TransactionError } from './transaction/errors.js'
import { TransactionalService } from './transaction/transactional.service.js'

/**
The constructor parameter of the embedded Relate provider: the Relate
database instance (its interface is private to driver/relate.ts, so it is
referenced structurally).
*/
type RelateDatabaseValue = ConstructorParameters<typeof RelateConnectionProvider>[0]

/**
A map-based schema definition as loaded from a model module (withDirectory).
The per-key values are validated by defineModel — the guard checks the
envelope.
*/
function isSchemaDefinition(value: unknown): value is SchemaDefinition {
  return isRecord(value)
}

/* eslint-disable unicorn/prefer-event-target -- the event emitter is shared with TransactionalService (its constructor takes it and calls on/emit), which an EventTarget adapter would break */
/**
The OGM facade: models, raw queries, transactions, schema management and
the event emitter, over a ConnectionProvider (neo4j-driver or the embedded
Relate engine). Construct via `forDriver` / `forRelate` / `fromEnv`, or
directly with a ConnectionProvider.
*/
export class Neode implements INeode {
  /**
  The structural minimum of the embedded Relate database (driver/relate.ts
  keeps its interface private).
  */
  private static isRelateDatabase(value: unknown): value is RelateDatabaseValue {
    return isRecord(value) && typeof value['connect'] === 'function'
  }

  /**
  Create a Neode instance over a neo4j-driver Driver
  (Neo4j Community / Enterprise, Memgraph, or any Bolt server)
  */
  static forDriver(
    driver: Driver,
    database?: string,
    isEnterprise = false,
    options: ConnectionOptions = {},
  ): Neode {
    return new Neode(new Neo4jConnectionProvider(driver, database), isEnterprise, options)
  }

  /**
  Create a Neode instance over an embedded Relate database
  (in-memory or file-backed)
  */
  static forRelate(
    database: unknown,
    namespace = 'neo4j',
    isEnterprise = false,
    options: ConnectionOptions = {},
  ): Neode {
    if (!this.isRelateDatabase(database)) {
      throw new TypeError(
        'forRelate expects an embedded Relate database instance (connect/checkpoint)',
      )
    }

    return new Neode(
      new RelateConnectionProvider(database, namespace, {
        ...(options.queueTimeoutMs !== undefined && { queueTimeoutMs: options.queueTimeoutMs }),
      }),
      isEnterprise,
      options,
    )
  }

  private readonly eventEmitter: EventEmitter = new EventEmitter()

  /**
  NTS-596: the instance's observer registry — `neode.observe()` registers
  here and this instance's write points look hooks up here, so observers
  never leak across instances. The module-global registry (the standalone
  `observe()` function) is chained as the fallback, so process-wide
  observers keep firing for every instance.
  */
  private readonly observers = new ObserverRegistry(globalObservers)

  private readonly connection: ConnectionProvider

  private database: string | undefined

  private defaultRouting: AccessMode | undefined

  private enterprise = false

  constructor(
    connection: ConnectionProvider,
    isEnterprise = false,
    options: ConnectionOptions = {},
  ) {
    this.enterprise = isEnterprise

    // Every statement — raw and service queries, inside and outside
    // transactions — funnels through this wrapper, the shared chokepoint
    // the query:executed lifecycle event emits from
    this.connection = instrumentConnectionProvider(connection, (event) =>
      this.eventEmitter.emit(EventType.QUERY_EXECUTED, event),
    )

    this.defaultRouting = options.defaultRouting

    // Instance methods on hydrated entities (save/update/delete/relateTo)
    // resolve their Neode through the last-constructed instance
    setDefaultNeode(this)
  }

  private getSchema(constructor: unknown): EntitySchema {
    const found = getModel(constructor)

    if (found === undefined) {
      const name = isConstructorOf(constructor) ? constructor.name : ''

      throw new NeodeError(
        `Couldn't find a model for "${name === '' ? 'unknown' : name}". Register it with @NodeEntity or defineModel() first.` +
          ` Registered model(s) are: ${Array.from(getModels().keys(), (model) => model.name)
            .filter((modelName) => modelName !== '')
            .join(', ')}`,
      )
    }

    return found
  }

  /**
  The unknown-relationship error naming the model and its defined
  relationships (NTS-446)
  */
  private unknownRelationship(schema: EntitySchema, keyOrType: string): NeodeError {
    const defined = schema.getRelationships().map((entry) => entry.getKey())

    return new NeodeError(
      `Unknown relationship "${keyOrType}" on model "${schema.getLabels().join(':') || 'entity'}"` +
        (defined.length > 0
          ? ` — defined relationships: ${defined.join(', ')}. ` +
            'Check the relationship key (or the relationship type), or declare it on the model.'
          : ' — the model declares no relationships; ' +
            'declare one with @OneToMany/@OneToOne or a relationship definition first.'),
    )
  }

  /**
  The relationship declared on the schema under the given key
  (neode's relateTo resolves the relationship by definition key)
  */
  private requireRelationship(schema: EntitySchema, key: string): RelationshipPropertySchema {
    if (!schema.hasRelationship(key)) {
      throw this.unknownRelationship(schema, key)
    }

    return schema.getRelationship(key)
  }

  /**
  Resolve a relationship by its definition KEY, falling back to the
  relationship TYPE (neode's relate(from, to, type) accepts either)
  */
  private resolveRelationship(schema: EntitySchema, keyOrType: string): RelationshipPropertySchema {
    if (schema.hasRelationship(keyOrType)) {
      return schema.getRelationship(keyOrType)
    }

    const byType = schema
      .getRelationships()
      .find((relationship) => relationship.getType() === keyOrType)

    if (byType) {
      return byType
    }

    throw this.unknownRelationship(schema, keyOrType)
  }

  /**
  The transaction the next unit of work runs on (NTS-156): the ambient
  transaction's handle when the calling async context has one — every
  facade read/write inside `transaction()` joins it, and the per-method
  commit()/rollback() defer to the outermost unit — else a fresh
  explicit transaction. The public openers (readTransaction /
  writeTransaction) never join: the explicit-handle API is unchanged.
  */
  private async beginWorkTransaction(
    mode: AccessMode,
    database?: string,
  ): Promise<TransactionHandle> {
    const ambient = ambientTransaction()

    return (
      ambient?.runner ?? (await this.connection.beginTransaction(mode, database ?? this.database))
    )
  }

  /**
  Run a write's side effect (lifecycle event, after* observer) once its
  data is committed (NTS-582): immediately for a facade call that already
  committed its own transaction, deferred to the outer commit when the call
  joined an ambient transaction (dropped if that rolls back or retries).
  */
  private async afterCommit(
    ambient: ReturnType<typeof ambientTransaction>,
    effect: () => void | Promise<void>,
  ): Promise<void> {
    if (ambient) {
      ambient.effects.defer(effect)

      return
    }

    await effect()
  }

  /**
  NTS-615: eager relationship creation shared by create() and update() —
  relate the given relationship key -> target(s) in the current unit of
  work's transaction. Edges are MERGE-based (idempotent on retry) and
  cardinality-guarded per edge by RelateService; any failure rolls the
  whole write back. `fromId` matches the freshly created node by
  elementId (create path — not yet hydrated).
  */
  private async eagerRelate(
    schema: EntitySchema,
    from: object,
    fromId: string | undefined,
    relate: Record<string, object | object[]> | undefined,
    tx: TransactionHandle,
  ): Promise<void> {
    if (relate === undefined) {
      return
    }

    for (const [relationshipKey, targets] of Object.entries(relate)) {
      const relationship = this.resolveRelationship(schema, relationshipKey)

      const list = isObjectArray(targets) ? targets : [targets]

      for (const entry of list) {
        await new RelateService(tx).relate(schema, from, entry, relationship, {}, false, fromId)
      }
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
    if (!isRecord(entity)) {
      throw new TypeError('Cannot save a value that is not an entity object')
    }

    const entityConstructor: unknown = entity.constructor

    if (!isConstructorOf<T>(entityConstructor)) {
      throw new TypeError('Cannot save a value whose constructor is not a class')
    }

    const schema = this.getSchema(entityConstructor)

    // NTS-511: beforeSave runs before the dirty check — an observer may
    // mutate the entity into dirtiness. Errors fail the write.
    await this.observers.run(entityConstructor, 'beforeSave', entity, {
      isNew: false,
      database,
    })

    // NTS-157: tracked (hydrated) instances write only their dirty
    // scalar properties; a clean instance is a no-op — no transaction,
    // no query, no lifecycle events — but only when saving to the same
    // (default) database. An explicit `database` overrides the no-op:
    // saving a clean entity to another database is how the audit-copy
    // pattern (save(entity, 'audit')) gets the node there.
    const dirtyKeys = diffDirty(schema, entity)

    if (database === undefined && isTracked(entity) && dirtyKeys.length === 0) {
      // Clean tracked instance: no write, no events — created: false, no summary
      return { saved: entity, created: false, summary: undefined }
    }

    const {
      hydrated: saved,
      created,
      summary,
    } = await this.inWriteTransaction(async (tx) => {
      const mergeService = new MergeService(tx.getRunner())

      // NTS-633: the merge statement's RETURN carries the written node —
      // hydrate it directly; FindByIdService stays as the fallback. The
      // re-hydration bypasses the read filters — the write path may
      // legitimately save outside the current filter view
      // (WITHOUT_ALL_FILTERS)
      const {
        elementId,
        created: wasCreated,
        summary,
        output,
      } = await mergeService.save(
        entity,
        schema,
        dirtyKeys.length > 0 ? new Set(dirtyKeys) : undefined,
      )

      const hydrated = await hydrateWrittenNode<T>(
        entityConstructor,
        schema,
        tx.getRunner(),
        output,
        elementId,
      )

      await tx.commit()

      if (hydrated === undefined) {
        throw new NeodeError('Entity was saved but could not be found immediately afterwards')
      }

      return { hydrated, created: wasCreated, summary }
    }, database)

    // Emit the lifecycle event the save actually was: a merge either created
    // the node or matched and updated an existing one
    await this.afterCommit(ambientTransaction(), async () => {
      this.eventEmitter.emit(created ? EventType.NODE_CREATED : EventType.NODE_UPDATED, saved)

      await this.observers.run(entityConstructor, 'afterSave', saved, {
        isNew: created,
        database,
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
    options?: CreateOptions | string,
    database?: string,
  ): Promise<T | undefined> {
    if (!isRecord(entity)) {
      throw new TypeError('Cannot update a value that is not an entity object')
    }

    const entityConstructor: unknown = entity.constructor

    if (!isConstructorOf<T>(entityConstructor)) {
      throw new TypeError('Cannot update a value whose constructor is not a class')
    }

    const schema = this.getSchema(entityConstructor)

    const relate = typeof options === 'string' ? undefined : options?.relate

    const databaseArg = typeof options === 'string' ? options : database

    // NTS-596: beforeSave before the statement — errors fail the write
    await this.observers.run(entityConstructor, 'beforeSave', properties, {
      isNew: false,
      database: databaseArg,
    })

    const tx = await this.beginWorkTransaction('WRITE', databaseArg)

    try {
      // NTS-633: the update statement's RETURN carries the mutated node —
      // hydrate it directly; FindByIdService stays as the fallback
      // (write-path re-hydration bypasses the read filters —
      // WITHOUT_ALL_FILTERS)
      const output = await new UpdateService(tx).update(schema, entity, properties, guard)

      // NTS-615: eager relationships — same transaction as the update;
      // the entity is hydrated, so RelateService matches it by identity
      await this.eagerRelate(schema, entity, undefined, relate, tx)

      const elementId = elementIdOfEntity(schema, entity)

      const hydrated = await hydrateWrittenNode<T>(entityConstructor, schema, tx, output, elementId)

      await tx.commit()

      // NTS-688: a guarded update that matched zero rows wrote nothing —
      // resolve undefined instead of re-hydrating the unchanged node (the
      // hydrateWrittenNode fallback re-reads the node, which would paper
      // over a failed guard). Nothing written — no lifecycle fires,
      // mirroring save()'s clean-instance no-op
      if (hydrated === undefined || (guard !== undefined && output.records.length === 0)) {
        return undefined
      }

      await this.afterCommit(ambientTransaction(), async () => {
        this.eventEmitter.emit(EventType.NODE_UPDATED, hydrated)

        await this.observers.run(entityConstructor, 'afterSave', hydrated, {
          isNew: false,
          database: databaseArg,
        })
      })

      return hydrated
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  getConnection(): ConnectionProvider {
    return this.connection
  }

  /**
  The runner statements run on right now (NTS-156): the ambient
  transaction's handle when the calling async context has one (so
  getRunner()-based paths — runCypherScript(), traverse() — join the
  ambient transaction), else the instance's connection.
  */
  getRunner(): Runner {
    return ambientTransaction()?.runner ?? this.connection
  }

  isEnterprise(): boolean {
    return this.enterprise
  }

  setEnterprise(isEnterprise: boolean): void {
    this.enterprise = isEnterprise
  }

  /**
  Set the default database for all future statements (neode parity).
  A per-call `database` argument wins over this default, which in turn
  wins over the provider's own constructor database.
  */
  setDatabase(database?: string): void {
    this.database = database
  }

  /**
  Subscribe to a lifecycle event — see EventType (common/events.ts).
  Returns this for chaining.
  */
  on(event: EventType, handler: NeodeEventHandler): this {
    this.eventEmitter.on(event, handler)

    return this
  }

  /**
  Unsubscribe a previously registered event handler.
  */
  off(event: EventType, handler: NeodeEventHandler): this {
    this.eventEmitter.off(event, handler)

    return this
  }

  /**
  Run a single statement in an implicit transaction
  */
  async readCypher(
    query: string,
    parameters: QueryParameters = {},
    database?: string,
  ): Promise<QueryOutput> {
    // NTS-156: inside an ambient transaction the statement joins it (the
    // per-call database override is ignored — the transaction is bound to
    // one database at open time)
    const ambient = ambientTransaction()

    return ambient
      ? ambient.runner.run(query, parameters)
      : this.connection.run(query, parameters, 'READ', database ?? this.database)
  }

  async writeCypher(
    query: string,
    parameters: QueryParameters = {},
    database?: string,
  ): Promise<QueryOutput> {
    const ambient = ambientTransaction()

    return ambient
      ? ambient.runner.run(query, parameters)
      : this.connection.run(query, parameters, 'WRITE', database ?? this.database)
  }

  /**
  Build-and-run sugar (NTS-553): pass a Builder to build-and-run it, or a
  string to pass it straight through to readCypher. Caller-supplied
  parameters merge over the builder's own params. Routes READ.

  NTS-559: with the `hydrate` option (the options object as the second
  or third argument) the rows are instead hydrated into entities of the
  given class, read from the `alias` column — the same overload
  `cypher()` offers. NTS-632: with the `recordTransformer` option (the
  options object as the third argument) each row is instead mapped
  through the transformer, JSON-safe values in; ignored when `hydrate`
  is set.
  */
  async read<T>(
    query: Builder | string,
    options: HydrateQueryOptions & { hydrate: new (...arguments_: never[]) => T },
  ): Promise<T[]>
  async read(
    query: Builder | string,
    parameters?: QueryParameters,
    database?: string,
  ): Promise<QueryOutput>
  async read<Row>(
    query: Builder | string,
    parameters: QueryParameters | undefined,
    options: HydrateQueryOptions & { recordTransformer: (record: QueryRecord) => Row },
  ): Promise<TransformedQueryOutput<Row>>
  async read<T>(
    query: Builder | string,
    parameters: QueryParameters | undefined,
    options: HydrateQueryOptions & { hydrate: new (...arguments_: never[]) => T },
  ): Promise<T[]>
  async read(
    query: Builder | string,
    parametersOrOptions: QueryParameters | HydrateQueryOptions = {},
    databaseOrOptions: string | HydrateQueryOptions = {},
  ): Promise<QueryOutput | unknown[] | TransformedQueryOutput> {
    const { parameters, options, database } = splitHydrateArguments(
      parametersOrOptions,
      databaseOrOptions,
    )

    if (typeof query === 'string') {
      const raw = await this.readCypher(query, parameters, database)

      return options.recordTransformer && options.hydrate === undefined
        ? mapRecords(options.recordTransformer, raw)
        : hydrateWhenRequested(options, raw)
    }

    const built = query.build()

    const output = await this.readCypher(built.query, { ...built.params, ...parameters }, database)

    return options.recordTransformer && options.hydrate === undefined
      ? mapRecords(options.recordTransformer, output)
      : hydrateWhenRequested(options, output)
  }

  /**
  WRITE counterpart of read(): pass a Builder to build-and-run it, or a
  string to pass it straight through to writeCypher. Routes WRITE. The
  `recordTransformer` option behaves as on read().
  */
  async write<T>(
    query: Builder | string,
    options: HydrateQueryOptions & { hydrate: new (...arguments_: never[]) => T },
  ): Promise<T[]>
  async write(
    query: Builder | string,
    parameters?: QueryParameters,
    database?: string,
  ): Promise<QueryOutput>
  async write<Row>(
    query: Builder | string,
    parameters: QueryParameters | undefined,
    options: HydrateQueryOptions & { recordTransformer: (record: QueryRecord) => Row },
  ): Promise<TransformedQueryOutput<Row>>
  async write<T>(
    query: Builder | string,
    parameters: QueryParameters | undefined,
    options: HydrateQueryOptions & { hydrate: new (...arguments_: never[]) => T },
  ): Promise<T[]>
  async write(
    query: Builder | string,
    parametersOrOptions: QueryParameters | HydrateQueryOptions = {},
    databaseOrOptions: string | HydrateQueryOptions = {},
  ): Promise<QueryOutput | unknown[] | TransformedQueryOutput> {
    const { parameters, options, database } = splitHydrateArguments(
      parametersOrOptions,
      databaseOrOptions,
    )

    if (typeof query === 'string') {
      const raw = await this.writeCypher(query, parameters, database)

      return options.recordTransformer && options.hydrate === undefined
        ? mapRecords(options.recordTransformer, raw)
        : hydrateWhenRequested(options, raw)
    }

    const built = query.build()

    const output = await this.writeCypher(built.query, { ...built.params, ...parameters }, database)

    return options.recordTransformer && options.hydrate === undefined
      ? mapRecords(options.recordTransformer, output)
      : hydrateWhenRequested(options, output)
  }

  /**
  Set the routing used when a query path leaves it open — `cypher()`
  without a per-call `routing` option (default READ)
  */
  setDefaultRouting(routing: AccessMode): void {
    this.defaultRouting = routing
  }

  /**
  The unified raw query escape hatch: run any Cypher statement through
  the instance's connection, choosing READ or WRITE per call (`routing`,
  falling back to the connection's `defaultRouting`, then READ).

  Rows come back JSON-safe (graph values — Node, Relationship, Path,
  Point — serialised to plain structures). With the `hydrate` option the
  rows are instead hydrated into entities of the given class, read from
  the `alias` column ('this' by default, matching the query builder's
  return alias). With `recordTransformer` each row is instead mapped
  through the transformer (JSON-safe values in, its return replaces the
  row); ignored when `hydrate` is set.
  */
  cypher(
    query: string,
    parameters?: QueryParameters,
    options?: Omit<CypherOptions, 'hydrate' | 'recordTransformer'>,
  ): Promise<QueryOutput>
  cypher<T>(
    query: string,
    parameters: QueryParameters | undefined,
    options: CypherOptions & { hydrate: new (...arguments_: never[]) => T },
  ): Promise<T[]>
  cypher<Row>(
    query: string,
    parameters: QueryParameters | undefined,
    options: CypherOptions & { recordTransformer: (record: QueryRecord) => Row },
  ): Promise<TransformedQueryOutput<Row>>
  async cypher(
    query: string,
    parameters: QueryParameters = {},
    options: CypherOptions = {},
  ): Promise<QueryOutput | unknown[] | TransformedQueryOutput> {
    // NTS-156: inside an ambient transaction the statement joins it; the
    // driver reports no summary for in-transaction runs, so the counters
    // come back empty
    const ambient = ambientTransaction()

    const output = ambient
      ? await ambient.runner.run(query, parameters)
      : await this.connection.run(
          query,
          parameters,
          options.routing ?? this.defaultRouting ?? 'READ',
          options.database ?? this.database,
        )

    if (options.hydrate) {
      return hydrateWhenRequested(options, output)
    }

    if (options.recordTransformer) {
      return mapRecords(options.recordTransformer, output)
    }

    return {
      records: output.records.map((record) => jsonSafeRecord(record)),
      summary: output.summary,
    }
  }

  /**
  The server's execution plan for the given statement (`EXPLAIN`): the
  driver's plan tree on backends that produce plans, `undefined` on
  those that don't (the embedded Relate engine accepts the keyword but
  reports no plan). EXPLAIN never executes the statement.
  */
  async explain(
    query: string,
    parameters: QueryParameters = {},
    options: { database?: string } = {},
  ): Promise<unknown> {
    // NTS-576: inside an ambient transaction the statement joins it
    // (a separate connection.run would queue behind the slot the
    // enclosing transaction holds)
    const ambient = ambientTransaction()

    const output = ambient
      ? await ambient.runner.run(`EXPLAIN ${query}`, parameters)
      : await this.connection.run(
          `EXPLAIN ${query}`,
          parameters,
          'READ',
          options.database ?? this.database,
        )

    return output.summary?.plan
  }

  /**
  The server's profiled plan for the given statement (`PROFILE`): unlike
  EXPLAIN the statement IS executed, so it routes WRITE. `undefined` on
  backends that produce no profiles (see explain()).
  */
  async profile(
    query: string,
    parameters: QueryParameters = {},
    options: { database?: string } = {},
  ): Promise<unknown> {
    // NTS-576: inside an ambient transaction the statement joins it
    // (a separate connection.run would queue behind the slot the
    // enclosing transaction holds)
    const ambient = ambientTransaction()

    const output = ambient
      ? await ambient.runner.run(`PROFILE ${query}`, parameters)
      : await this.connection.run(
          `PROFILE ${query}`,
          parameters,
          'WRITE',
          options.database ?? this.database,
        )

    return output.summary?.profile
  }

  /**
  Open an explicit READ transaction
  */
  async readTransaction(database?: string): Promise<TransactionHandle> {
    return this.connection.beginTransaction('READ', database ?? this.database)
  }

  /**
  Open an explicit WRITE transaction
  */
  async writeTransaction(database?: string): Promise<TransactionHandle> {
    return this.connection.beginTransaction('WRITE', database ?? this.database)
  }

  /**
  Open a transaction and return a TransactionalService
  (remember to call .commit() or .rollback())
  */
  async openReadTransaction(database?: string): Promise<TransactionalService> {
    const handle = await this.readTransaction(database)

    return new TransactionalService(
      handle,
      this.eventEmitter,
      undefined,
      true,
      this.observers,
      this.connection,
    )
  }

  /**
  Open a transaction and return a TransactionalService
  (remember to call .commit() or .rollback())
  */
  async openWriteTransaction(database?: string): Promise<TransactionalService> {
    const handle = await this.writeTransaction(database)

    return new TransactionalService(
      handle,
      this.eventEmitter,
      undefined,
      true,
      this.observers,
      this.connection,
    )
  }

  /**
  Run a unit of work within a READ transaction: the transaction commits
  on success unless the work committed explicitly, and rolls back when
  the work throws. Inside an ambient transaction (NTS-156) the work joins
  it instead — same transaction, close endpoints deferred to the
  outermost unit.

  The unit binds its transaction as the ambient scope for the callback
  (NTS-642): facade methods called inside — `neode.cypher`, `neode.create`,
  … — join the SAME transaction, on every backend. Before, they fell
  through to autocommit: silently outside the unit on Bolt, and a deadlock
  on the embedded Relate engine's single transaction slot. Never retries.
  */
  async inReadTransaction<T>(
    work: (tx: TransactionalService) => Promise<T>,
    database?: string,
  ): Promise<T> {
    const ambient = ambientTransaction()

    if (ambient) {
      ambient.assertCompatible('inReadTransaction()', {
        database,
      })

      return ambient.join(this.eventEmitter, work, this.observers)
    }

    const resolved = database ?? this.database

    return runAmbientTransaction(
      async () => this.connection.beginTransaction('READ', resolved),
      this.eventEmitter,
      work,
      resolved === undefined
        ? { routing: 'READ', retries: 0 }
        : { routing: 'READ', database: resolved, retries: 0 },
      this.observers,
      this.connection,
    )
  }

  /**
  Run a unit of work within a WRITE transaction: the transaction commits
  on success unless the work committed explicitly, and rolls back when
  the work throws. Inside an ambient transaction (NTS-156) the work joins
  it instead — same transaction, close endpoints deferred to the
  outermost unit.

  The unit binds its transaction as the ambient scope for the callback
  (NTS-642): facade methods called inside — `neode.cypher`, `neode.create`,
  … — join the SAME transaction, on every backend. Before, they fell
  through to autocommit: silently outside the unit on Bolt, and a deadlock
  on the embedded Relate engine's single transaction slot. Never retries.
  */
  async inWriteTransaction<T>(
    work: (tx: TransactionalService) => Promise<T>,
    database?: string,
  ): Promise<T> {
    const ambient = ambientTransaction()

    if (ambient) {
      ambient.assertCompatible('inWriteTransaction()', {
        database,
        routing: 'WRITE',
      })

      return ambient.join(this.eventEmitter, work, this.observers)
    }

    const resolved = database ?? this.database

    return runAmbientTransaction(
      async () => this.connection.beginTransaction('WRITE', resolved),
      this.eventEmitter,
      work,
      resolved === undefined
        ? { routing: 'WRITE', retries: 0 }
        : { routing: 'WRITE', database: resolved, retries: 0 },
      this.observers,
      this.connection,
    )
  }

  /**
  Run a unit of work in an AMBIENT transaction (NTS-156): the transaction
  lives in AsyncLocalStorage for the duration of the callback, so every
  facade/repository call inside joins it without threading a handle.

  - Nested `transaction()` calls join the outer transaction (no
    savepoints in v1).
  - Close semantics follow the managed scopes (NTS-561): the transaction
    commits when the callback resolves and rolls back when it throws; an
    explicit `tx.commit()` / `tx.rollback()` inside the callback works.
  - DEFAULT RETRIES: a failure classified as transient (TransientError —
    `Neo.TransientError.*` codes or a driver `retryable` verdict) retries
    the WHOLE callback in a fresh transaction, `retries` times (default
    2, with jittered backoff; pass `retries: 0` to disable — unlike
    inWriteTransaction, which never retries). The callback must be
    idempotent: work that reached the database rolls back with the failed
    attempt, but non-database side effects run again on retry.
    Terminated / LockClientStopped transactions are never retried.
  - A failure while COMMITTING is not retried (the server may have
    committed before the connection dropped, so a re-run could apply the
    work twice) unless `retryCommit: true`.
  - Lifecycle events (NODE_CREATED, …) and afterSave / afterDelete
    observers fire only after the commit; they are dropped on rollback and
    on a retried attempt.
  - A nested call that passes a conflicting `routing` / `database` /
    `retries` / `retryCommit` throws — the nested call joins the outer
    transaction, so those options can only be set on the outermost unit.
  - Work that runs after the callback finished (un-awaited promises) throws
    "transaction already finished".
  - `routing` ('WRITE' default | 'READ') and `database` choose the
    transaction's session — per transaction, not per call.

  Requires a runtime with AsyncLocalStorage (node:async_hooks). On
  runtimes without it (some edge/serverless targets) keep using the
  explicit-handle API — `readTransaction()` / `writeTransaction()`,
  `openReadTransaction()` / `openWriteTransaction()` and this class's
  managed `inReadTransaction()` / `inWriteTransaction()` — which never
  touches ALS.

  Joining the ambient transaction: every model read/write
  (find/get/all/save/create/merge/update/relate/detach/delete), runAll(),
  and the raw Cypher paths (cypher/readCypher/writeCypher and the
  read()/write() sugar), plus (NTS-576)
  search(), knn(), pagination (paginate/chunk/lazy), bulk
  (createMany/mergeMany) and explain()/profile(). NOT joining: the
  schema-management methods (installSchema, dropSchema, inspect/drift,
  graph type, full-text/vector index DDL) — they run on the connection
  directly and, on the embedded Relate engine, queue behind the
  transaction's slot: run them outside `transaction()`.
  */
  async transaction<T>(
    work: (tx: TransactionalService) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    const ambient = ambientTransaction()

    // Already inside an ambient transaction: join it — no begin, no close,
    // and no retry of its own (the outermost unit's retry re-runs the
    // whole callback, so an inner retry would double-apply the work)
    if (ambient) {
      ambient.assertCompatible('transaction()', options)

      return ambient.join(this.eventEmitter, work, this.observers)
    }

    const database = options.database ?? this.database

    return runAmbientTransaction(
      async () =>
        this.connection.beginTransaction(
          options.routing ?? 'WRITE',
          options.database ?? this.database,
        ),
      this.eventEmitter,
      work,
      database === undefined ? options : { ...options, database },
      this.observers,
      this.connection,
    )
  }

  /**
  Run every statement of the batch within ONE transaction (v3's batch(),
  renamed runAll() — NTS-624: the statements run sequentially, the ONE
  transaction is the point, not throughput): begin, run every statement,
  then commit. On any failure the transaction is rolled back and a
  TransactionError is thrown, carrying the per-statement errors (aligned
  with the batch, null where a statement succeeded), the partial results
  and the failed statements' details.
  */
  async runAll(
    queries: (string | { query: string; params?: QueryParameters })[],
    database?: string,
  ): Promise<QueryOutput[]> {
    const tx = await this.beginWorkTransaction('WRITE', database)

    const results: QueryOutput[] = []
    const errors: (BatchStatementError | null)[] = []
    const details: BatchStatementError[] = []

    // Every statement is attempted, so the error report covers the batch
    for (const [index, entry] of queries.entries()) {
      const query = typeof entry === 'string' ? entry : entry.query
      const parameters = (typeof entry === 'string' ? {} : entry.params) ?? {}

      try {
        results.push(await tx.run(query, parameters))
        errors.push(null)
      } catch (error) {
        const failed: BatchStatementError = { index, query, params: parameters, error }
        errors.push(failed)
        details.push(failed)
      }
    }

    if (details.length > 0) {
      return await rollbackAfterFailure(tx, new TransactionError(errors, results, details))
    }

    await tx.commit()

    return results
  }

  /**
  Fan operations out across CONCURRENT sessions (NTS-631) — a map (or
  array) of operation CALLBACKS, each run on its own session:

  ```ts
  const { tiles, throughput } = await neode.parallel({
    tiles: (scope) => scope.read(dashboardTilesQuery),
    throughput: (scope) => scope.read(dashboardThroughputQuery),
  })
  ```

  - mode 'read' (default) — one READ autocommit session per operation: N
    independent reads in one wall-clock batch (the dashboard case).
  - mode 'write' — one WRITE autocommit session per operation; NO
    cross-operation atomicity (a failure halfway leaves the earlier
    writes committed). Every operation still runs; the failures surface
    in one ParallelError aligned with the input.
  - mode 'atomic' — all-or-nothing across sessions: one WRITE transaction
    per operation, every body in parallel against its own transaction,
    then the transactions commit sequentially ONLY if every body
    succeeded — any body failure rolls back every open transaction. A
    commit-phase failure remains the residual risk (surfaced per handle
    as a 'commit'-phase ParallelError).

  Operations are callbacks receiving the operation's own ParallelScope —
  a session- (autocommit modes) or transaction- (atomic) bound Runner
  with the facade's build-and-run sugar — NOT promises: a transaction
  cannot open before its body runs. parallel() owns the transactions'
  lifecycle; bodies cannot commit or roll back. Called inside a
  `transaction()` callback it still fans out fresh sessions (deliberately
  outside the ambient transaction).

  Contention caveat: parallel writes touching the same nodes serialize on
  the database's locks — keep operation sets NODE-DISJOINT; same-node
  writes belong in ONE transaction, run sequentially
  (inWriteTransaction() / transaction()).

  Backend caveat: atomic mode needs a backend with concurrent sessions
  (neo4j-driver over Bolt). The embedded Relate engine runs ONE
  transaction per connection — its begin queue releases the slot only on
  commit/rollback — so atomic mode with more than one operation
  deadlocks there: on Relate use the autocommit modes (statements queue
  safely — correct, but no wall-clock gain) or keep the writes in one
  sequential transaction (runAll() / transaction()).

  Map in, map out; array in, array out (input order). One transaction
  for sequential statements stays runAll() / transaction().

  - `operations` — named map or array of callbacks over ParallelScope
  - `options` — mode ('read' | 'write' | 'atomic', default 'read') and
    database
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
    return runParallel(this.connection, operations, options)
  }

  /**
  Run statements to create the schema
  */
  async installSchema(): Promise<SchemaResult[]> {
    // NTS-598 — EXISTS / property-type constraints follow the edition
    // detected from the connection, not the manual flag
    const service = new SchemaService(this.connection)

    return service.create()
  }

  /**
  Run statements to drop the schema. DESTRUCTIVE: drops every constraint and
  index the registered models declare on the connected database (by
  deterministic name, so objects other applications created under other
  names are untouched) — never run it against a database you do not own.
  */
  async dropSchema(): Promise<SchemaResult[]> {
    const service = new SchemaService(this.connection)

    return service.drop()
  }

  /**
  Create a Repository. Generic over the model CONSTRUCTOR (NTS-563): the
  repository's `with` load spec is map-checked against the model's
  `neodeRelationships` phantom static and find / findAll narrow their
  returns to the hydrated shape — the same with() contract as the facade
  paths (NTS-154).
  */
  getRepository<C extends Newable>(entity: C, database?: string): Repository<InstanceType<C>, C> {
    return resolveRepository(this, entity, database)
  }

  /**
  Map-narrowed load spec (NTS-154): `options.with` checked against the
  model's type-level relationship map (the `neodeRelationships` phantom
  static, falling back to the declared object/array field keys) — the
  resolved entity's type carries every requested relationship:
  `find(Person, id, { with: { pets: { toys: true } } })` resolves to
  `(Person & { pets: (Pet & { toys: Toy[] })[] }) | undefined`. Nested
  spec levels and the level's order / skip / limit trims ride the same
  statement (the NTS-498 machinery).
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
    const schema = this.getSchema(constructor)

    const options = typeof databaseOrOptions === 'object' ? databaseOrOptions : undefined
    const database = typeof databaseOrOptions === 'string' ? databaseOrOptions : options?.database
    const withSpec = options?.with
    assertPublicWithoutFilters(options?.withoutFilters)
    const filters =
      options?.withoutFilters === undefined ? undefined : { withoutFilters: options.withoutFilters }

    const tx = await this.beginWorkTransaction('READ', database)

    try {
      // A load spec reads through the projection path even when the model
      // declares no projected properties — it renders the requested
      // relationships into the RETURN projection
      const output =
        withSpec !== undefined || hasProjectedProperties(schema)
          ? await new ProjectionService(tx).find<T>(constructor, schema, value, withSpec, filters)
          : await new FindService(tx).find<T>(constructor, schema, value, filters)

      await tx.commit()

      return output
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  async findById<T>(
    constructor: new (...arguments_: never[]) => T,
    elementId: string,
    database?: string,
  ): Promise<T | undefined> {
    const schema = this.getSchema(constructor)

    const tx = await this.beginWorkTransaction('READ', database)

    try {
      const output = hasProjectedProperties(schema)
        ? await new ProjectionService(tx).findById<T>(constructor, schema, elementId)
        : await new FindByIdService(tx).find<T>(constructor, schema, elementId)

      await tx.commit()

      return output
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  async get<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters: Record<string, unknown>,
    limit?: number,
    skip?: number,
    databaseOrOptions?: string | { withoutFilters?: string[] | undefined },
  ): Promise<T[]> {
    const schema = this.getSchema(constructor)

    assertPublicWithoutFilters(
      typeof databaseOrOptions === 'object' ? databaseOrOptions.withoutFilters : undefined,
    )

    const filters =
      typeof databaseOrOptions === 'object' && databaseOrOptions.withoutFilters !== undefined
        ? { withoutFilters: databaseOrOptions.withoutFilters }
        : undefined

    const database = typeof databaseOrOptions === 'string' ? databaseOrOptions : undefined

    const tx = await this.beginWorkTransaction('READ', database)

    try {
      const results = hasProjectedProperties(schema)
        ? await new ProjectionService(tx).get<T>(
            constructor,
            schema,
            parameters,
            limit,
            skip,
            undefined,
            undefined,
            filters,
          )
        : await new GetService(tx).get<T>(
            constructor,
            schema,
            parameters,
            limit,
            skip,
            undefined,
            filters,
          )

      await tx.commit()

      return results
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  async getFirst<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters: Record<string, unknown>,
    database?: string,
  ): Promise<T | undefined> {
    const records = await this.get<T>(constructor, parameters, 1, 0, database)

    return records[0]
  }

  /**
  Find the first node matching a key / value pair (or a property map),
  neode's Model.first(): sugar over getFirst()
  */
  async first<T>(
    constructor: new (...arguments_: never[]) => T,
    key: string | Record<string, unknown>,
    value?: unknown,
    database?: string,
  ): Promise<T | undefined> {
    const parameters = typeof key === 'object' ? key : { [key]: value }

    return this.getFirst<T>(constructor, parameters, database)
  }

  async save<T>(entity: T, database?: string): Promise<T> {
    const outcome = await this.saveOutcome(entity, database)

    return outcome.saved
  }

  /**
  CREATE a new entity of the given constructor with the given properties
  (nested relationship targets included), then hydrate the created node.

  NTS-615: `options.relate` maps a relationship key on the model to a
  saved target entity (or array of targets) to relate it to — eager
  relationship creation in the same managed transaction as the create, so
  a failure mid-write leaves no orphan node. Edges are MERGE-based:
  retries stay idempotent. The legacy form `create(constructor,
  properties, database)` — a string third argument, as accepted by
  callers before options — is kept working.
  */
  async create<T>(
    constructor: new (...arguments_: never[]) => T,
    properties: Record<string, unknown> = {},
    options?: CreateOptions | string,
    database?: string,
  ): Promise<T> {
    const schema = this.getSchema(constructor)

    const relate = typeof options === 'string' ? undefined : options?.relate

    const databaseArg = typeof options === 'string' ? options : database

    // NTS-511: beforeSave before the statement — errors fail the create
    await this.observers.run(constructor, 'beforeSave', properties, {
      isNew: true,
      database: databaseArg,
    })

    const tx = await this.beginWorkTransaction('WRITE', databaseArg)

    try {
      const constructed = new constructor()

      if (!isRecord(constructed)) {
        throw new NeodeError('The model constructor did not produce an entity object')
      }

      Object.assign(constructed, properties)

      const service = new CreateService(tx)

      // NTS-633: the CREATE statement's RETURN carries the written node —
      // hydrate it directly; FindByIdService stays as the fallback
      // (write-path re-hydration bypasses the read filters —
      // WITHOUT_ALL_FILTERS). NTS-628: the relationshipProperties carrier
      // rides along.
      const { elementId, output } = await service.create(
        schema,
        constructed,
        typeof options === 'string' ? undefined : options?.relationshipProperties,
      )

      // NTS-615: eager relationships — same transaction as the create
      // (atomic from the caller's view; a mid-write failure rolls the
      // node and its edges back together)
      await this.eagerRelate(schema, constructed, elementId, relate, tx)

      const hydrated = await hydrateWrittenNode<T>(constructor, schema, tx, output, elementId)

      if (hydrated === undefined) {
        throw new NeodeError('Entity was created but could not be found immediately afterwards')
      }

      await tx.commit()

      // Emit event (after the outer commit when joined to an ambient transaction)
      await this.afterCommit(ambientTransaction(), async () => {
        this.eventEmitter.emit(EventType.NODE_CREATED, hydrated)

        await this.observers.run(constructor, 'afterSave', hydrated, {
          isNew: true,
          database: databaseArg,
        })
      })

      return hydrated
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  MERGE a node on the given match properties, then set the given
  properties, hydrating the merged node. NTS-596: the merge lifecycle runs
  the save hooks and emits NODE_MERGED with the re-hydrated node once
  committed (also the event path behind merge() and Repository#upsert).
  Resolves to the merge outcome (NTS-630): `{ entity, created, updated,
  counts, summary }` — `created` when the MERGE created the node,
  `updated` when it matched and wrote, both false on a no-op merge.
  */
  async mergeOn<T>(
    constructor: new (...arguments_: never[]) => T,
    match: Record<string, unknown>,
    set: Record<string, unknown> = {},
    database?: string,
  ): Promise<MergeResult<T> | undefined> {
    const schema = this.getSchema(constructor)

    // NTS-596: beforeSave runs before the statement and receives the set
    // record (the create-path contract — a mutable record of what the
    // write sets). Errors fail the write.
    await this.observers.run(constructor, 'beforeSave', set, { isNew: false, database })

    const tx = await this.beginWorkTransaction('WRITE', database)

    try {
      const mergeService = new MergeService(tx)

      const output = await mergeService.mergeOn(schema, match, set)

      // The summary counters say whether the MERGE created the node (the
      // same read the save path makes) — the honest isNew for afterSave
      const counters = output.summary?.counters ?? {}

      const wasCreated = (counters['nodesCreated'] ?? counters['nodes_created'] ?? 0) > 0

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
      const hydrated = await hydrateWrittenNode<T>(constructor, schema, tx, output, elementId)

      await tx.commit()

      await this.afterCommit(ambientTransaction(), async () => {
        if (hydrated !== undefined) {
          this.eventEmitter.emit(EventType.NODE_MERGED, hydrated)
        }

        await this.observers.run(constructor, 'afterSave', hydrated ?? set, {
          isNew: wasCreated,
          database,
        })
      })

      return hydrated === undefined
        ? undefined
        : { entity: hydrated, ...mergeOutcome(output.summary), summary: output.summary }
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  MERGE a node of the given constructor on its merge fields (the unique
  and indexed properties, neode's Model.merge): those present in
  `properties` form the match, everything else is set, with schema
  defaults resolving for properties not given. Resolves to the same
  merge outcome mergeOn() returns (NTS-630)
  */
  async merge<T>(
    constructor: new (...arguments_: never[]) => T,
    properties: Record<string, unknown> = {},
    database?: string,
  ): Promise<MergeResult<T> | undefined> {
    const schema = this.getSchema(constructor)

    // Relationship values (or arrays of them) in the properties mean
    // relationship writes — those go through the save() path, which
    // already creates/relates nested relationships (neode's merge
    // semantics: "Neode will create relationships when either a Node
    // instance, ID property or Object containing match parameters
    // is passed"). NTS-627: primary-key values are relationship writes
    // too — they route through save() like entity instances.
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

      const { saved, created, summary } = await this.saveOutcome(constructed, database)

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
  UPDATE the given properties on a node (`+=` semantics: provided keys
  only, matched by the entity's primary key), then re-hydrate it.

  NTS-615: `options.relate` maps a relationship key on the model to a
  saved target entity (or array of targets) to relate it to, inside the
  same managed transaction as the update (create() parity). The legacy
  form `update(entity, properties, database)` — a string third argument —
  is kept working.

  NTS-596: the update path runs the save lifecycle — beforeSave receives
  the properties record (mutate it to change what is written), and
  NODE_UPDATED + afterSave fire once committed (isNew is false: an update
  never creates).
  */
  async update<T>(
    entity: T,
    properties: Record<string, unknown> = {},
    options?: CreateOptions | string,
    database?: string,
  ): Promise<T | undefined> {
    return await this.updateInternal(entity, properties, undefined, options, database)
  }

  /**
  Update the given properties only when a guard predicate holds on the
  matched node (NTS-688) — the compare-and-swap write for
  "reserve/claim/transition only if still in state X" flows. The guard is
  trusted-input Cypher referencing the node as `this`; its values bind as
  parameters. Resolves `undefined` when the guard failed (zero matched
  rows) — nothing written, no lifecycle events — and composes with @Version:
  a stale version still throws `OptimisticLockError`.
  */
  async updateWhere<T>(
    entity: T,
    guard: UpdateGuard,
    properties: Record<string, unknown> = {},
    database?: string,
  ): Promise<T | undefined> {
    return await this.updateInternal(entity, properties, guard, undefined, database)
  }

  /**
  Relate two saved nodes, resolving the relationship by its KEY on the
  from-entity's schema (neode's node.relateTo(node, relationshipName)):
  MERGE the relationship, or CREATE with `forceCreate`
  */
  async relate(
    constructor: Newable,
    from: object,
    to: object,
    relationshipKey: string,
    properties: Record<string, unknown> = {},
    shouldForceCreate = false,
    database?: string,
  ): Promise<GraphRelationship | undefined> {
    const schema = this.getSchema(constructor)
    const relationship = this.resolveRelationship(schema, relationshipKey)

    const tx = await this.beginWorkTransaction('WRITE', database)

    try {
      const result = await new RelateService(tx).relate(
        schema,
        from,
        to,
        relationship,
        properties,
        shouldForceCreate,
      )

      await tx.commit()

      if (result) {
        await this.afterCommit(ambientTransaction(), () => {
          this.eventEmitter.emit(
            shouldForceCreate ? EventType.RELATIONSHIP_CREATED : EventType.RELATIONSHIP_MERGED,
            result,
          )
        })
      }

      return result
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  Remove the relationship of the given key between two nodes and return
  both re-hydrated
  */
  async detach(
    constructor: Newable,
    from: object,
    to: object,
    relationshipKey: string,
    database?: string,
  ): Promise<DetachResult<object, object>> {
    const schema = this.getSchema(constructor)
    const relationship = this.requireRelationship(schema, relationshipKey)

    const tx = await this.beginWorkTransaction('WRITE', database)

    try {
      const result = await new DetachService(tx).detach(schema, from, to, relationship)

      await tx.commit()

      return result
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  Replace every edge of ONE declared relationship on a node in a single
  statement (NTS-634): the relationship's existing edges are deleted and
  the new set created — no read-modify-write, no TOCTOU window. Targets
  are entity instances or primary-key values; `properties` are applied to
  every created edge; `options.merge` MERGEs the new edges instead of
  CREATEing them. Resolves the relationship by key (or type, relate()
  parity); BOTH-direction declarations are rejected (match-only, NTS-483).
  */
  async replaceRelationship(
    entity: object,
    key: string,
    targets: unknown[],
    properties: Record<string, unknown> = {},
    options?: ReplaceRelationshipOptions,
    database?: string,
  ): Promise<void> {
    const schema = this.getSchema(constructorOf(entity))
    const relationship = this.resolveRelationship(schema, key)

    const tx = await this.beginWorkTransaction('WRITE', database)

    try {
      await new ReplaceRelationshipService(tx).replaceRelationship(
        schema,
        entity,
        relationship,
        targets,
        properties,
        options,
      )

      await tx.commit()
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  Set the properties of ONE declared relationship's edge (NTS-628): match
  both nodes by identity, MERGE the edge (never duplicating it) and SET
  the properties — idempotent per re-run, the update path relate()'s
  create-time properties cannot serve. Validates against the
  relationship's declared `properties` schema when one is declared.
  Resolves the relationship by key (or type, relate() parity).
  */
  async updateEdgeProperties(
    entity: object,
    key: string,
    target: object,
    properties: Record<string, unknown> = {},
    database?: string,
  ): Promise<GraphRelationship | undefined> {
    const schema = this.getSchema(constructorOf(entity))
    const relationship = this.resolveRelationship(schema, key)

    const tx = await this.beginWorkTransaction('WRITE', database)

    try {
      const result = await new RelateService(tx).updateEdgeProperties(
        schema,
        entity,
        relationship,
        target,
        properties,
      )

      await tx.commit()

      return result
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  Diff-and-apply a relationship's edges to an EXACT target set (NTS-161,
  Eloquent `sync` precedent): relate the missing targets, detach the
  absent ones, leave the common ones untouched — a no-op sync writes
  nothing. `options.properties` is applied to the edges NEWLY related.
  Cardinality is checked before any write: syncing a `one` relationship
  with two targets throws CardinalityViolationError.
  */
  async syncEdges(
    constructor: Newable,
    from: object,
    relationshipKey: string,
    targets: object[],
    options: SyncEdgesOptions = {},
    database?: string,
  ): Promise<SyncEdgesResult> {
    const schema = this.getSchema(constructor)
    const relationship = this.requireRelationship(schema, relationshipKey)

    const tx = await this.beginWorkTransaction('WRITE', database)

    try {
      const result = await new SyncService(tx).sync(schema, from, relationship, targets, options)

      await tx.commit()

      return result
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  Lazy relation load (NTS-558): traverse ONE declared relationship off a
  hydrated entity — the loader the RelationNotLoadedError message
  promises — and materialize the result as an own property on the
  instance, so strict relation access (NTS-155) reads it back without
  throwing. `options` pushes order/skip/limit into the traversal's
  ORDER BY / SKIP / LIMIT.
  */
  async loadRelation(
    constructor: Newable,
    entity: object,
    relationshipKey: string,
    options?: LoadOptions,
  ): Promise<unknown> {
    const schema = this.getSchema(constructor)
    const relationship = this.requireRelationship(schema, relationshipKey)

    const tx = await this.beginWorkTransaction('READ')

    try {
      const result = await new LoadRelationService(tx).load(schema, entity, relationship, options)

      await tx.commit()

      return result
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  Multi-key, multi-level per-instance load (NTS-498): the spec object's
  keys name relationships on the entity's schema — `true` loads all, an
  object decorates that level's traversal (order / skip / limit) and
  nested keys descend one level down. One read transaction; one traversal
  statement per root key; nested levels ride that statement's projection.
  The whole spec validates against the declared relationship graph before
  the first read — an unknown key at ANY level throws the schema's
  descriptive error naming the valid keys.
  */
  async loadRelationSpec(constructor: Newable, entity: object, spec: object): Promise<void> {
    const schema = this.getSchema(constructor)

    const tx = await this.beginWorkTransaction('READ')

    try {
      await new LoadRelationService(tx).loadSpec(schema, entity, spec)

      await tx.commit()
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  The related() scope (NTS-497): the queryable generalisation of
  loadRelation() — Builder-style verbs (where / orderBy / limit / skip)
  composed on top of one declared relationship traversal off a hydrated
  entity, with terminal find() / first() / count() running it and
  hydrating the related entities. Each terminal runs its own READ
  transaction; the target model's global filters apply inside the
  traversal read.
  */
  relatedQuery(
    constructor: Newable,
    entity: object,
    relationshipKey: string,
    options?: { withoutFilters?: string[] | undefined },
  ): RelatedQuery {
    const schema = this.getSchema(constructor)

    assertPublicWithoutFilters(options?.withoutFilters)

    const relationship = this.requireRelationship(schema, relationshipKey)

    return new RelatedQuery(
      async (work) => {
        const tx = await this.beginWorkTransaction('READ')

        try {
          const result = await work(tx)

          await tx.commit()

          return result
        } catch (error) {
          return await rollbackAfterFailure(tx, error)
        }
      },
      schema,
      entity,
      relationship,
      options?.withoutFilters === undefined
        ? undefined
        : { withoutFilters: options.withoutFilters },
    )
  }

  /**
  ALL nodes of the given constructor, optionally filtered by properties,
  ordered, limited and skipped (neode's all())
  */
  /**
  Full-text search over a full-text index (NTS-123): hydrated entities
  with their relevance score, best match first. Pass user text through
  `toFulltextQuery()` — the query is bound as a parameter, but Lucene
  syntax characters in it are still parsed as such.
  */
  async search<T>(
    constructor: new (...arguments_: never[]) => T,
    indexName: string,
    query: string,
    limit?: number,
    filters?: { withoutFilters?: string[] | undefined },
  ): Promise<ScoredEntity<T>[]> {
    assertPublicWithoutFilters(filters?.withoutFilters)

    return search<T>(this.getRunner(), constructor, indexName, query, limit, filters)
  }

  /**
  k-nearest-neighbour search over a vector index (NTS-127): hydrated
  entities with their similarity score, best match first
  */
  async knn<T>(
    constructor: new (...arguments_: never[]) => T,
    indexName: string,
    vector: number[],
    k: number,
    mode?: KnnMode,
    filters?: { withoutFilters?: string[] | undefined },
  ): Promise<ScoredEntity<T>[]> {
    assertPublicWithoutFilters(filters?.withoutFilters)

    return knn<T>(this.getRunner(), constructor, indexName, vector, k, mode, filters)
  }

  /**
  Agent-readable ontology over every registered model in JSON form
  (NTS-445) — entities with their labels, descriptions, properties and
  relationships, for LLM consumers
  */
  ontology(): Ontology {
    return ontology()
  }

  /**
  Agent-readable ontology over every registered model, rendered as
  prompt-ready markdown (NTS-445)
  */
  ontologyMarkdown(): string {
    return ontologyMarkdown()
  }

  /**
  Read the installed database schema (SHOW CONSTRAINTS / SHOW INDEXES)
  and diff it against the declared schema of the registered models
  (NTS-142)
  */
  async inspectSchema(options: InspectOptions = {}): Promise<SchemaInspection> {
    return inspectSchema(this.connection, options)
  }

  /**
  Database introspector (NTS-164): generate model definitions from the
  graph — node labels, sampled property types (N nodes per label; absent
  properties optional; conflicting types a descriptive NeodeError),
  relationships with direction, and the unique constraint's property as
  the primary-key suggestion — as decorated TypeScript classes and map
  schemas. Constraints and indexes are not re-declared: the generated
  models round-trip through installSchema() with no drift.
  */
  async generateModels(options: GenerateModelsOptions = {}): Promise<GenerateModelsResult> {
    return generateModels(this.connection, options)
  }

  /**
  Structured schema drift: the declared-vs-installed constraints and
  every index kind (range/text/fulltext/vector), each entry carrying
  the exact fix statement (NTS-450). Drift is data, not an error —
  this never throws on drift; failing a CI run on a non-empty diff is
  the caller's job.
  */
  async schemaDiff(options: InspectOptions = {}): Promise<SchemaDrift> {
    return schemaDrift(this.connection, options)
  }

  /**
  Human-readable schema drift report, grouped by missing / stale /
  mismatched with the fix statement per line (NTS-450)
  */
  formatSchemaDiff(diff: SchemaDrift): string {
    return formatSchemaDrift(diff)
  }

  /**
  Apply the missing objects of a schema drift idempotently; stale
  objects are only dropped with `dropStale: true` (dropping is
  destructive: they are installed on the connected database, which on a
  shared one may belong to other applications). Reports each statement like installSchema (NTS-450)
  */
  async applySchemaDiff(
    diff: SchemaDrift,
    options: ApplySchemaDiffOptions = {},
  ): Promise<SchemaResult[]> {
    return applySchemaDrift(this.connection, diff, options)
  }

  /**
  Install the given full-text index definitions (NTS-123)
  */
  async installFulltextIndexes(definitions: FulltextIndexDefinition[]): Promise<SchemaResult[]> {
    return new FulltextIndexService(this.connection, definitions).create()
  }

  /**
  Drop the given full-text index definitions (NTS-123)
  */
  async dropFulltextIndexes(definitions: FulltextIndexDefinition[]): Promise<SchemaResult[]> {
    return new FulltextIndexService(this.connection, definitions).drop()
  }

  /**
  Install the given vector index definitions (NTS-127)
  */
  async installVectorIndexes(definitions: VectorIndexDefinition[]): Promise<SchemaResult[]> {
    return new VectorIndexService(this.connection, definitions).create()
  }

  /**
  Drop the given vector index definitions (NTS-127)
  */
  async dropVectorIndexes(definitions: VectorIndexDefinition[]): Promise<SchemaResult[]> {
    return new VectorIndexService(this.connection, definitions).drop()
  }

  /**
  Derive the graph type from the registered models and set it as the
  database's enforced schema (NTS-548). Enterprise Edition + Neo4j 2026.02+
  only; deliberately standalone from installSchema().

  Non-destructive by default (NTS-578): only the missing element types and
  constraint items are `ADD`ed; foreign graph type objects (other apps on a
  shared database) are left alone, and definitions that differ are reported
  as failed results rather than rewritten. `replace: true` opts into
  `ALTER CURRENT GRAPH TYPE SET`, replacing the server's whole graph type —
  refused when it would drop objects no registered model declares, unless
  `canDropUndeclared: true`.

  `options.constraints` appends named `CONSTRAINT ... FOR ... REQUIRE`
  items (NTS-549) — the only way to constrain labels/types that are not
  identifying ones, e.g. `{ labelOrType: 'Animal', properties: ['id'],
  kind: 'UNIQUE' }`
  */
  async installGraphType(options: GraphTypeCreateOptions = {}): Promise<SchemaResult[]> {
    return new GraphTypeService(this.connection, this.enterprise).create(options)
  }

  /**
  Drop the graph type elements derived from the registered models (NTS-548),
  including the named constraint items (NTS-549). DESTRUCTIVE: it drops
  those element types from the connected database's graph type — dropping an element type
  removes its dependent constraints but leaves its uniqueness/key ones,
  which only go by name
  */
  async dropGraphType(
    options: { constraints?: GraphTypeConstraintDefinition[] } = {},
  ): Promise<SchemaResult[]> {
    return new GraphTypeService(this.connection, this.enterprise).drop(options)
  }

  /**
  Extend the installed graph type with the derived (or given) new element
  types and constraint items — `ALTER CURRENT GRAPH TYPE ADD` (NTS-551).
  Only additions are valid: existing element types cannot be modified.
  */
  async extendGraphType(definition?: GraphTypeDefinition): Promise<SchemaResult[]> {
    return new GraphTypeService(this.connection, this.enterprise).extend(definition)
  }

  /**
  Redefine existing element types in the installed graph type —
  `ALTER CURRENT GRAPH TYPE ALTER` (NTS-551). Without a definition, the
  model-derived element types are redefined with their key/uniqueness
  constraints stripped (those remain unchanged server-side and cannot be
  altered).
  */
  async alterGraphType(definition?: GraphTypeDefinition): Promise<SchemaResult[]> {
    return new GraphTypeService(this.connection, this.enterprise).alter(definition)
  }

  /**
  CREATE every row in chunks of `UNWIND $rows ...` (NTS-126): one managed
  write transaction per chunk, rows validated like create() before the
  first write. NTS-596: every row runs beforeSave (create-path semantics —
  the row record, mutable, errors fail the write), and every created
  entity emits NODE_CREATED + afterSave once its chunk committed.
  */
  async createMany<T>(
    constructor: new (...arguments_: never[]) => T,
    rows: Record<string, unknown>[] = [],
    options: BulkOptions = {},
    database?: string,
  ): Promise<BulkChunk<T>[]> {
    for (const row of rows) {
      await this.observers.run(constructor, 'beforeSave', row, { isNew: true, database })
    }

    const chunks = await new BulkService(this.getRunner()).createMany<T>(
      constructor,
      this.getSchema(constructor),
      rows,
      { ...options, database },
    )

    await this.afterCommit(ambientTransaction(), async () => {
      for (const chunk of chunks) {
        for (const entity of chunk.entities) {
          this.eventEmitter.emit(EventType.NODE_CREATED, entity)

          await this.observers.run(constructor, 'afterSave', entity, { isNew: true, database })
        }
      }
    })

    return chunks
  }

  /**
  MERGE every row in chunks on the model's merge fields (NTS-126): one
  managed write transaction per chunk; every row must merge on the same
  merge fields. NTS-596: every row runs beforeSave, and every merged
  entity emits NODE_MERGED + afterSave once its chunk committed. A bulk
  row's create-vs-match is not observable per row, so afterSave sees
  isNew: false — NODE_MERGED is the event.
  */
  async mergeMany<T>(
    constructor: new (...arguments_: never[]) => T,
    rows: Record<string, unknown>[] = [],
    options: BulkOptions = {},
    database?: string,
  ): Promise<BulkChunk<T>[]> {
    for (const row of rows) {
      await this.observers.run(constructor, 'beforeSave', row, { isNew: false, database })
    }

    const chunks = await new BulkService(this.getRunner()).mergeMany<T>(
      constructor,
      this.getSchema(constructor),
      rows,
      { ...options, database },
    )

    await this.afterCommit(ambientTransaction(), async () => {
      for (const chunk of chunks) {
        for (const entity of chunk.entities) {
          this.eventEmitter.emit(EventType.NODE_MERGED, entity)

          await this.observers.run(constructor, 'afterSave', entity, { isNew: false, database })
        }
      }
    })

    return chunks
  }

  /**
  Map one import row (a CSV / JSON / NDJSON record) to the property map
  createMany() / mergeMany() take: header renames, defaults, fakes,
  transforms, validation and type conversion through the model schema —
  collecting failures per row (`{ ok: false, errors }`) instead of
  throwing, the accumulate-and-report shape file imports want.
  */
  async rowToProperties(
    constructor: new (...arguments_: never[]) => unknown,
    row: Record<string, unknown>,
    options: RowToPropertiesOptions = {},
  ): Promise<RowPropertiesResult> {
    return rowToProperties(this.getSchema(constructor), row, options)
  }

  /**
  Pagination helper (NTS-125). Offset mode — `{ page, limit, order? }` —
  returns `{ items, total, page, limit, totalPages }`; keyset mode —
  `{ limit, orderBy?, after?/before? }` — walks a temporal property and
  returns `{ items, nextCursor, hasMore }`
  */
  async paginate<T>(
    constructor: new (...arguments_: never[]) => T,
    filter: Record<string, unknown>,
    options: OffsetPaginateOptions,
  ): Promise<Page<T>>
  async paginate<T>(
    constructor: new (...arguments_: never[]) => T,
    filter: Record<string, unknown>,
    options: CursorPaginateOptions,
  ): Promise<CursorPage<T>>
  async paginate<T>(
    constructor: new (...arguments_: never[]) => T,
    filter: Record<string, unknown> = {},
    options?: OffsetPaginateOptions | CursorPaginateOptions,
  ): Promise<Page<T> | CursorPage<T>> {
    assertPublicWithoutFilters(options?.withoutFilters)

    return new PaginateService(this.getRunner()).paginate<T>(
      constructor,
      this.getSchema(constructor),
      filter,
      options ?? { limit: 25 },
    )
  }

  /**
  Non-paginated `{ items, total }` read (NTS-166): every entity matching
  the filter plus its total in one call. Options trim the data read
  only — `total` is always the full filter count.
  */
  async findManyAndCount<T>(
    constructor: new (...arguments_: never[]) => T,
    filter: Record<string, unknown> = {},
    options: FindManyAndCountOptions = {},
  ): Promise<ManyAndCount<T>> {
    assertPublicWithoutFilters(options.withoutFilters)

    return new PaginateService(this.getRunner()).findManyAndCount<T>(
      constructor,
      this.getSchema(constructor),
      filter,
      options,
    )
  }

  /**
  Walk a large read in chunks of `size` items (NTS-166), paged by keyset
  so memory stays flat. The callback receives each chunk in keyset
  order; return false to stop early. Resolves to the number of items
  delivered.
  */
  async chunk<T>(
    constructor: new (...arguments_: never[]) => T,
    filter: Record<string, unknown>,
    size: number,
    callback: (items: T[]) => unknown,
    options: { orderBy?: string; withoutFilters?: string[] | undefined } = {},
  ): Promise<number> {
    assertPublicWithoutFilters(options.withoutFilters)

    return new PaginateService(this.getRunner()).chunk<T>(
      constructor,
      this.getSchema(constructor),
      filter,
      size,
      callback,
      options,
    )
  }

  /**
  Async iterator over a large read (NTS-166): pages by keyset under the
  hood, yielding one entity at a time, so memory stays flat. Breaking
  out of the for-await loop stops the walk cleanly — each page is its
  own autocommit read, so no session is left open.
  */
  async *lazy<T>(
    constructor: new (...arguments_: never[]) => T,
    filter: Record<string, unknown> = {},
    options: StreamOptions = {},
  ): AsyncGenerator<T> {
    assertPublicWithoutFilters(options.withoutFilters)

    yield* new PaginateService(this.getRunner()).lazy<T>(
      constructor,
      this.getSchema(constructor),
      filter,
      options,
    )
  }

  /**
  Run a semicolon-split Cypher script sequentially (NTS-134), one
  autocommit statement at a time, fail-fast
  */
  async runCypherScript(
    content: string,
    options: RunCypherScriptOptions = {},
  ): Promise<QueryOutput[]> {
    return runCypherScript(this.getRunner(), content, options)
  }

  /**
  Map-narrowed load spec (NTS-154): `options.with` checked against the
  model's type-level relationship map — every entity's type carries the
  requested relationships, `all(Person, {}, undefined, undefined,
  undefined, undefined, { with: { pets: true } })` resolves to
  `(Person & { pets: Pet[] })[]`. Nested spec levels ride the same
  statement (the NTS-498 machinery).
  */
  async all<C extends Newable, const WithSpecT extends QueryLoadSpec<C> = never>(
    constructor: C,
    parameters?: Record<string, unknown>,
    order?: OrderSpec,
    limit?: number,
    skip?: number,
    database?: string,
    options?: { with: WithSpecT; withoutFilters?: string[] | undefined },
  ): Promise<LoadedEntity<InstanceType<C>, WithSpecT>[]>
  async all<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters?: Record<string, unknown>,
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
    const schema = this.getSchema(constructor)

    assertPublicWithoutFilters(options?.withoutFilters)

    const tx = await this.beginWorkTransaction('READ', database)

    try {
      const withSpec = options?.with
      const filters =
        options?.withoutFilters === undefined
          ? undefined
          : { withoutFilters: options.withoutFilters }

      const results =
        withSpec !== undefined || hasProjectedProperties(schema)
          ? await new ProjectionService(tx).get<T>(
              constructor,
              schema,
              parameters,
              limit,
              skip,
              order,
              withSpec,
              filters,
            )
          : await new GetService(tx).get<T>(
              constructor,
              schema,
              parameters,
              limit,
              skip,
              order,
              filters,
            )

      await tx.commit()

      return results
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  Nodes of the given constructor within `distance` of the given point,
  ordered by distance when `order` is 'distance'
  (neode's FindWithinDistance). The model's named read filters apply;
  `filters.withoutFilters` opts names out (NTS-574).
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
    filters?: { withoutFilters?: string[] | undefined },
  ): Promise<T[]> {
    const schema = this.getSchema(constructor)

    assertPublicWithoutFilters(filters?.withoutFilters)

    const tx = await this.beginWorkTransaction('READ', database)

    try {
      const results = await new WithinDistanceService(tx).withinDistance<T>(
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

      await tx.commit()

      return results
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  A factory builder for seeding fake data (NTS-444): chain `.count(n)`,
  `.with(relationshipName, { count, properties })`,
  `.has(otherFactory, relationshipName)`, `.make(overrides)` for
  unsaved instances and `.create(overrides)`. Accepts a model name
  (map-defined via model() / with()) or a decorated model class.
  */
  factory<T extends object>(model: new (...arguments_: never[]) => T): FactoryBuilder<T>
  factory(model: string | Newable): FactoryBuilder
  factory(model: string | Newable): FactoryBuilder {
    return new FactoryBuilder(this, model)
  }

  /**
  Define a model from a map-based schema definition (neode parity), or,
  when no schema is given, look up a previously defined model by name.
  */
  model(name: string, schema?: SchemaDefinition): Newable {
    if (schema) {
      return defineModel(name, schema)
    }

    const existing = getModelByName(name)

    if (!existing) {
      throw new NeodeError(unknownDefinitionError(name))
    }

    return existing
  }

  /**
  Define multiple models at once: { Name: schemaDefinition }
  */
  with(models: Record<string, SchemaDefinition>): this {
    for (const [name, schema] of Object.entries(models)) {
      this.model(name, schema)
    }

    return this
  }

  /**
  Scan a directory and register each module's default export as a model
  named after the file (neode parity, extended to .ts files)
  */
  withDirectory(directory: string): this {
    const requireModule = createRequire(import.meta.url)

    const files = readdirSync(directory).filter((file) =>
      ['.js', '.ts'].includes(path.extname(file).toLowerCase()),
    )

    for (const file of files) {
      const name = path.basename(file, path.extname(file))
      const loaded: unknown = requireModule(path.resolve(directory, file))

      // A module's default export is the definition; the module itself
      // is the fallback (neode parity)
      const candidate =
        isRecord(loaded) && loaded['default'] !== undefined && loaded['default'] !== null
          ? loaded['default']
          : loaded

      if (!isSchemaDefinition(candidate)) {
        throw new TypeError(
          `Cannot register model "${name}" from ${file}: the module did not export a schema definition`,
        )
      }

      this.model(name, candidate)
    }

    return this
  }

  /**
  neode's extend(): clone a model under a new name, adding the new name
  as an extra label, with the given schema merged on top
  */
  extend(name: string, as: string, schema?: SchemaDefinition): Newable {
    return extendModel(name, as, schema)
  }

  /**
  Register lifecycle observers for a model (NTS-511): beforeSave runs
  inside the write (an error fails it), afterSave/afterDelete run after
  hydration. Returns the off function.
  */
  observe(model: Newable, observers: ModelObservers): () => void {
    return this.observers.observe(model, observers)
  }

  /**
  Typed multi-hop traversal (NTS-512): chain hops, run, read hydrated
  rows — one row per matched path, origin entity first.
  */
  traverse(model: Newable, options?: { withoutFilters?: string[] | undefined }): TraverseBuilder {
    if (!(getModel(model) instanceof EntitySchema)) {
      throw new NeodeError('traverse() requires a registered model — register it first')
    }

    const builder = new TraverseBuilder(this.getRunner(), () => model)

    return options?.withoutFilters === undefined
      ? builder
      : builder.withoutFilters(...options.withoutFilters)
  }

  /**
  Delete a node. `options` threads the cascade modes through to the
  delete service; the legacy form `delete(entity, database)` — a string
  second argument, as accepted by INeode — is kept working.
  */
  async delete(entity: object, options?: DeleteOptions | string, database?: string): Promise<void> {
    const schema = this.getSchema(constructorOf(entity))

    // A soft delete only SETs a label — the node stays, so it is not a
    // deletion and must not fire NODE_DELETED. The declarative
    // @SoftDelete stamp (NTS-510) counts as soft unless forced.
    const cascadeOptions: DeleteOptions | undefined =
      typeof options === 'string' ? undefined : options

    const schemaSoft = schema.getSoftDelete()

    const isSoft =
      cascadeOptions?.force !== true &&
      (schemaSoft !== undefined ||
        (cascadeOptions?.soft !== undefined && cascadeOptions.soft !== ''))

    const tx = await this.beginWorkTransaction(
      'WRITE',
      typeof options === 'string' ? options : database,
    )

    try {
      await this.observers.run(constructorOf(entity), 'beforeDelete', entity, {
        isNew: false,
        database,
      })

      await new DeleteService(tx).delete(schema, entity, cascadeOptions)

      await tx.commit()
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }

    await this.afterCommit(ambientTransaction(), async () => {
      // Event BEFORE the after* observer (NTS-596): a hook error surfaces
      // after the commit but never suppresses the emission
      if (isSoft) {
        // A soft delete only SETs a label — the node survived, so the
        // committed change is an update, not a deletion (NTS-596)
        this.eventEmitter.emit(EventType.NODE_UPDATED, entity)
      } else if (cascadeOptions?.soft === undefined || cascadeOptions.soft === '') {
        // Emit event
        this.eventEmitter.emit(EventType.NODE_DELETED, entity)
      }

      await this.observers.run(constructorOf(entity), 'afterDelete', entity, {
        isNew: false,
        database,
      })
    })
  }

  /**
  DETACH DELETE every node of the given constructor matching the given
  properties, returning the deleted count (neode's Model.deleteAll,
  extended with a count return).

  Guarded like Repository.deleteAll (NTS-595): an unfiltered call is
  refused — pass at least one property, or `{ all: true }` to confirm
  the wipe. NTS-596: the matched nodes are read and hydrated first, so
  the delete lifecycle runs per entity — beforeDelete before the delete
  statement (an error fails the whole delete), and NODE_DELETED +
  afterDelete once committed.
  */
  async deleteAll(
    constructor: Newable,
    parameters_: Record<string, unknown> = {},
    database?: string,
  ): Promise<number> {
    const schema = this.getSchema(constructor)

    assertDeleteAllScope(parameters_, schema.getLabels())

    // Schema-declared keys only (get() parity): anything else would be raw
    // interpolation into the statement, so unknown keys are ignored
    const matchBuilder = (): Builder => {
      const builder = new Builder().match('n', schema.getLabels())

      for (const property of schema.getProperties()) {
        const key = property.getKey()

        if (Object.hasOwn(parameters_, key)) {
          builder.where(`n.${quote(key)}`, parameters_[key])
        }
      }

      return builder
    }

    // Read the matched nodes before deleting them — the delete lifecycle
    // (NTS-596) needs the entities to observe. Two statements: a row
    // created between them is deleted without an event (bulk semantics).
    const { query: readQuery, params: readParams } = matchBuilder().return('n').build()

    const matched = await this.writeCypher(readQuery, readParams, database)

    const entities = hydrate(constructor, matched, 'n')

    for (const entity of entities) {
      await this.observers.run(constructor, 'beforeDelete', entity, {
        isNew: false,
        database,
      })
    }

    const { query, params: parameters } = matchBuilder()
      .detachDelete('n')
      .return('count(n) AS count')
      .build()

    const output = await this.writeCypher(query, parameters, database)

    const firstRecord = output.records[0]

    if (firstRecord === undefined) {
      throw new NeodeError('count query returned no records')
    }

    await this.afterCommit(ambientTransaction(), async () => {
      for (const entity of entities) {
        this.eventEmitter.emit(EventType.NODE_DELETED, entity)

        await this.observers.run(constructor, 'afterDelete', entity, {
          isNew: false,
          database,
        })
      }
    })

    return Number(firstRecord.get('count'))
  }

  /**
  SET / REMOVE a label on the node matched by the entity's elementId and
  re-hydrate — the write behind the entity instance methods addLabel() /
  removeLabel() (NTS-596): the save hooks run around it and NODE_UPDATED
  carries the re-hydrated node once committed (a label change is an
  update, not a deletion).
  */
  async applyLabel<T extends object>(
    entity: T,
    label: string,
    verb: 'SET' | 'REMOVE',
    database?: string,
  ): Promise<T | undefined> {
    const constructor = constructorOf(entity)

    if (constructor === undefined) {
      throw new NeodeError('Entity has no constructor — cannot resolve its model')
    }

    const schema = this.getSchema(constructor)

    // NTS-596: beforeSave before the statement — errors fail the write
    await this.observers.run(constructor, 'beforeSave', entity, { isNew: false, database })

    const elementId = elementIdOfEntity(schema, entity)

    if (elementId === undefined) {
      throw new NeodeError('Entity has no elementId — save() it before changing its labels')
    }

    const tx = await this.beginWorkTransaction('WRITE', database)

    try {
      await tx.run(`MATCH (n) WHERE elementId(n) = $elementId ${verb} n:${quote(label)}`, {
        elementId,
      })

      // Write-path re-hydration bypasses the read filters (WITHOUT_ALL_FILTERS)
      const hydrated = await new FindByIdService(tx).find<T>(constructor, schema, elementId, {
        withoutFilters: [WITHOUT_ALL_FILTERS],
      })

      await tx.commit()

      await this.afterCommit(ambientTransaction(), async () => {
        if (hydrated !== undefined) {
          this.eventEmitter.emit(EventType.NODE_UPDATED, hydrated)
        }

        await this.observers.run(constructor, 'afterSave', hydrated ?? entity, {
          isNew: false,
          database,
        })
      })

      return hydrated
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  Return a Builder bound to this instance (neode parity, extended by
  NTS-554): chain the fluent builder methods, then run the result with
  the .read() / .write() terminals (READ / WRITE routing through
  Neode#read/#write) — or the inherited .execute(getConnection()) as
  before. A `database` argument is forwarded to the terminals.
  */
  query(database?: string): BoundBuilder {
    return new BoundBuilder(this, database)
  }

  /**
  Close the underlying connection (neode parity)
  */
  async close(): Promise<void> {
    return this.connection.close()
  }
}
/* eslint-enable unicorn/name-replacements -- "Neo4j" is the product name; the rule's `j` -> `index` replacement misfires on it */
/* eslint-enable unicorn/prefer-event-target -- the emitter is shared with TransactionalService, which an EventTarget adapter would break */
