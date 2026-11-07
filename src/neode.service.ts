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
  QueryOutput,
  QueryParams as QueryParameters,
  Runner,
  TransactionHandle,
} from './driver/types.js'
import { elementIdOfEntity } from './element-id.js'
import { setDefaultNeode } from './entity-methods.js'
import { NeodeError } from './errors/index.js'
import { hydrate } from './hydrate.js'
import type { EntitySchema } from './meta/entity/entity-schema.js'
import { getModel, getModels } from './meta/index.js'
import {
  defineModel,
  extendModel,
  getModelByName,
  unknownDefinitionError,
} from './meta/map-schema.js'
import type { Newable } from './meta/newable.js'
import { type Ontology, ontology, ontologyMarkdown } from './meta/ontology.js'
import type { RelationshipPropertySchema } from './meta/relationship-property-schema.js'
import { resolveRepository } from './meta/repositories.js'
import type { SchemaDefinition } from './meta/schema-definition.interface.js'
import type { INeode } from './neode.interface.js'
import { type RunCypherScriptOptions, runCypherScript } from './ops/index.js'
import { hasProjectedProperties } from './projection/index.js'
import { ProjectionService } from './projection/projection.service.js'
import { Builder } from './query/index.js'
import { quote } from './query/quote.js'
import type { Repository } from './repository/index.js'
import { FactoryBuilder } from './services/factory.service.js'
import { type BulkChunk, type BulkOptions, BulkService } from './services/query/bulk.service.js'
import { CreateService } from './services/query/create.service.js'
import { type DeleteOptions, DeleteService } from './services/query/delete.service.js'
import { type DetachResult, DetachService } from './services/query/detach.service.js'
import { diffDirty, isTracked } from './dirty.js'
import { FindService } from './services/query/find.service.js'
import { FindByIdService } from './services/query/find-by-id.service.js'
import { GetService, type OrderSpec } from './services/query/get.service.js'
import { type KnnMode, knn } from './services/query/knn.service.js'
import { getMergeFields, MergeService } from './services/query/merge.service.js'
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
import { UpdateService } from './services/query/update.service.js'
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
import { constructorOf, isConstructorOf, isRecord } from './services/type-guards.js'
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

    return new Neode(new RelateConnectionProvider(database, namespace), isEnterprise, options)
  }

  private readonly eventEmitter: EventEmitter = new EventEmitter()

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

  getConnection(): ConnectionProvider {
    return this.connection
  }

  getRunner(): Runner {
    return this.connection
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
    return this.connection.run(query, parameters, 'READ', database ?? this.database)
  }

  async writeCypher(
    query: string,
    parameters: QueryParameters = {},
    database?: string,
  ): Promise<QueryOutput> {
    return this.connection.run(query, parameters, 'WRITE', database ?? this.database)
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
  return alias).
  */
  cypher(query: string, parameters?: QueryParameters, options?: CypherOptions): Promise<QueryOutput>
  cypher<T>(
    query: string,
    parameters: QueryParameters | undefined,
    options: CypherOptions & { hydrate: new (...arguments_: never[]) => T },
  ): Promise<T[]>
  async cypher(
    query: string,
    parameters: QueryParameters = {},
    options: CypherOptions = {},
  ): Promise<QueryOutput | unknown[]> {
    const output = await this.connection.run(
      query,
      parameters,
      options.routing ?? this.defaultRouting ?? 'READ',
      options.database ?? this.database,
    )

    const rows: QueryOutput = {
      records: output.records.map((record) => jsonSafeRecord(record)),
      summary: output.summary,
    }

    return options.hydrate ? hydrate(options.hydrate, rows, options.alias) : rows
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
    const output = await this.connection.run(
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
    const output = await this.connection.run(
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

    return new TransactionalService(handle, this.eventEmitter)
  }

  /**
  Open a transaction and return a TransactionalService
  (remember to call .commit() or .rollback())
  */
  async openWriteTransaction(database?: string): Promise<TransactionalService> {
    const handle = await this.writeTransaction(database)

    return new TransactionalService(handle, this.eventEmitter)
  }

  /**
  Run a unit of work within a READ transaction
  */
  async inReadTransaction<T>(
    work: (tx: TransactionalService) => Promise<T>,
    database?: string,
  ): Promise<T> {
    const tx = await this.openReadTransaction(database)

    try {
      return await work(tx)
    } catch (error) {
      return await rollbackAfterFailure(tx.getTransaction(), error)
    }
  }

  /**
  Run a unit of work within a WRITE transaction
  */
  async inWriteTransaction<T>(
    work: (tx: TransactionalService) => Promise<T>,
    database?: string,
  ): Promise<T> {
    const tx = await this.openWriteTransaction(database)

    try {
      return await work(tx)
    } catch (error) {
      return await rollbackAfterFailure(tx.getTransaction(), error)
    }
  }

  /**
  Run a batch of statements within ONE transaction (neode's batch()):
  begin, run every statement, then commit. On any failure the transaction
  is rolled back and a TransactionError is thrown, carrying the
  per-statement errors (aligned with the batch, null where a statement
  succeeded), the partial results and the failed statements' details.
  */
  async batch(
    queries: (string | { query: string; params?: QueryParameters })[],
    database?: string,
  ): Promise<QueryOutput[]> {
    const tx = await this.connection.beginTransaction('WRITE', database ?? this.database)

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
  Run statements to create the schema
  */
  async installSchema(): Promise<SchemaResult[]> {
    const service = new SchemaService(this.connection, this.enterprise)

    return service.create()
  }

  /**
  Run statements to drop the schema
  */
  async dropSchema(): Promise<SchemaResult[]> {
    const service = new SchemaService(this.connection, this.enterprise)

    return service.drop()
  }

  /**
  Create a Repository
  */
  getRepository<Entity>(
    entity: new (...arguments_: never[]) => Entity,
    database?: string,
  ): Repository<Entity> {
    return resolveRepository(this, entity, database)
  }

  async find<T>(
    constructor: new (...arguments_: never[]) => T,
    value: string,
    database?: string,
  ): Promise<T | undefined> {
    const schema = this.getSchema(constructor)

    const tx = await this.readTransaction(database)

    try {
      const output = hasProjectedProperties(schema)
        ? await new ProjectionService(tx).find<T>(constructor, schema, value)
        : await new FindService(tx).find<T>(constructor, schema, value)

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

    const tx = await this.readTransaction(database)

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
    database?: string,
  ): Promise<T[]> {
    const schema = this.getSchema(constructor)

    const tx = await this.readTransaction(database)

    try {
      const results = hasProjectedProperties(schema)
        ? await new ProjectionService(tx).get<T>(constructor, schema, parameters, limit, skip)
        : await new GetService(tx).get<T>(constructor, schema, parameters, limit, skip)

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
    if (!isRecord(entity)) {
      throw new TypeError('Cannot save a value that is not an entity object')
    }

    const entityConstructor: unknown = entity.constructor

    if (!isConstructorOf<T>(entityConstructor)) {
      throw new TypeError('Cannot save a value whose constructor is not a class')
    }

    const schema = this.getSchema(entityConstructor)

    // NTS-157: tracked (hydrated) instances write only their dirty
    // scalar properties; a clean instance is a no-op — no transaction,
    // no query, no lifecycle events
    const dirtyKeys = diffDirty(schema, entity)

    if (isTracked(entity) && dirtyKeys.length === 0) {
      return entity
    }

    const { hydrated: saved, created } = await this.inWriteTransaction(async (tx) => {
      const mergeService = new MergeService(tx.getRunner())

      const { elementId, created: wasCreated } = await mergeService.save(
        entity,
        schema,
        dirtyKeys.length > 0 ? new Set(dirtyKeys) : undefined,
      )

      const findService = new FindByIdService(tx.getRunner())

      const hydrated = await findService.find<T>(entityConstructor, schema, elementId)

      await tx.commit()

      if (hydrated === undefined) {
        throw new NeodeError('Entity was saved but could not be found immediately afterwards')
      }

      return { hydrated, created: wasCreated }
    }, database)

    // Emit the lifecycle event the save actually was: a merge either created
    // the node or matched and updated an existing one
    this.eventEmitter.emit(created ? EventType.NODE_CREATED : EventType.NODE_UPDATED, saved)

    return saved
  }

  /**
  CREATE a new entity of the given constructor with the given properties
  (nested relationship targets included), then hydrate the created node
  */
  async create<T>(
    constructor: new (...arguments_: never[]) => T,
    properties: Record<string, unknown> = {},
    database?: string,
  ): Promise<T> {
    const schema = this.getSchema(constructor)

    const tx = await this.writeTransaction(database)

    try {
      const constructed = new constructor()

      if (!isRecord(constructed)) {
        throw new NeodeError('The model constructor did not produce an entity object')
      }

      Object.assign(constructed, properties)

      const service = new CreateService(tx)

      const { elementId } = await service.create(schema, constructed)

      const findService = new FindByIdService(tx)

      const hydrated = await findService.find<T>(constructor, schema, elementId)

      if (hydrated === undefined) {
        throw new NeodeError('Entity was created but could not be found immediately afterwards')
      }

      await tx.commit()

      // Emit event
      this.eventEmitter.emit(EventType.NODE_CREATED, hydrated)

      return hydrated
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  MERGE a node on the given match properties, then set the given
  properties, hydrating the merged node
  */
  async mergeOn<T>(
    constructor: new (...arguments_: never[]) => T,
    match: Record<string, unknown>,
    set: Record<string, unknown> = {},
    database?: string,
  ): Promise<T | undefined> {
    const schema = this.getSchema(constructor)

    const tx = await this.writeTransaction(database)

    try {
      const mergeService = new MergeService(tx)

      const output = await mergeService.mergeOn(schema, match, set)

      const firstRecord = output.records[0]

      if (firstRecord === undefined) {
        throw new NeodeError('mergeOn returned no records')
      }

      const elementId = firstRecord.get(INTERNAL_ID)

      if (typeof elementId !== 'string') {
        throw new NeodeError('mergeOn did not return an elementId')
      }

      const findService = new FindByIdService(tx)

      const hydrated = await findService.find<T>(constructor, schema, elementId)

      await tx.commit()

      return hydrated
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  MERGE a node of the given constructor on its merge fields (the unique
  and indexed properties, neode's Model.merge): those present in
  `properties` form the match, everything else is set, with schema
  defaults resolving for properties not given
  */
  async merge<T>(
    constructor: new (...arguments_: never[]) => T,
    properties: Record<string, unknown> = {},
    database?: string,
  ): Promise<T | undefined> {
    const schema = this.getSchema(constructor)

    // Entity instances (or arrays of them) in the properties mean
    // relationship writes — those go through the save() path, which
    // already creates/relates nested relationships (neode's merge
    // semantics: "Neode will create relationships when either a Node
    // instance, ID property or Object containing match parameters
    // is passed")
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

      return this.save(constructed, database)
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
  only, matched by the entity's primary key), then re-hydrate it
  */
  async update<T>(
    entity: T,
    properties: Record<string, unknown> = {},
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

    const tx = await this.writeTransaction(database)

    try {
      await new UpdateService(tx).update(schema, entity, properties)

      const elementId = elementIdOfEntity(schema, entity)

      const hydrated =
        elementId === undefined
          ? undefined
          : await new FindByIdService(tx).find<T>(entityConstructor, schema, elementId)

      await tx.commit()

      return hydrated
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
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

    const tx = await this.writeTransaction(database)

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
        this.eventEmitter.emit(
          shouldForceCreate ? EventType.RELATIONSHIP_CREATED : EventType.RELATIONSHIP_MERGED,
          result,
        )
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

    const tx = await this.writeTransaction(database)

    try {
      const result = await new DetachService(tx).detach(schema, from, to, relationship)

      await tx.commit()

      return result
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
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
  ): Promise<ScoredEntity<T>[]> {
    return search<T>(this.connection, constructor, indexName, query, limit)
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
  ): Promise<ScoredEntity<T>[]> {
    return knn<T>(this.connection, constructor, indexName, vector, k, mode)
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
    return inspectSchema(this.connection, { enterprise: this.enterprise, ...options })
  }

  /**
  Structured schema drift: the declared-vs-installed constraints and
  every index kind (range/text/fulltext/vector), each entry carrying
  the exact fix statement (NTS-450). Drift is data, not an error —
  this never throws on drift; failing a CI run on a non-empty diff is
  the caller's job.
  */
  async schemaDiff(options: InspectOptions = {}): Promise<SchemaDrift> {
    return schemaDrift(this.connection, { enterprise: this.enterprise, ...options })
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
  destructive). Reports each statement like installSchema (NTS-450)
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
  CREATE every row in chunks of `UNWIND $rows ...` (NTS-126): one managed
  write transaction per chunk, rows validated like create() before the
  first write
  */
  async createMany<T>(
    constructor: new (...arguments_: never[]) => T,
    rows: Record<string, unknown>[] = [],
    options: BulkOptions = {},
    database?: string,
  ): Promise<BulkChunk<T>[]> {
    return new BulkService(this.connection).createMany<T>(
      constructor,
      this.getSchema(constructor),
      rows,
      { ...options, database },
    )
  }

  /**
  MERGE every row in chunks on the model's merge fields (NTS-126): one
  managed write transaction per chunk; every row must merge on the same
  merge fields
  */
  async mergeMany<T>(
    constructor: new (...arguments_: never[]) => T,
    rows: Record<string, unknown>[] = [],
    options: BulkOptions = {},
    database?: string,
  ): Promise<BulkChunk<T>[]> {
    return new BulkService(this.connection).mergeMany<T>(
      constructor,
      this.getSchema(constructor),
      rows,
      { ...options, database },
    )
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
    return new PaginateService(this.connection).paginate<T>(
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
    return new PaginateService(this.connection).findManyAndCount<T>(
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
    options: { orderBy?: string } = {},
  ): Promise<number> {
    return new PaginateService(this.connection).chunk<T>(
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
    yield* new PaginateService(this.connection).lazy<T>(
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

  async all<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters: Record<string, unknown> = {},
    order?: OrderSpec,
    limit?: number,
    skip?: number,
    database?: string,
  ): Promise<T[]> {
    const schema = this.getSchema(constructor)

    const tx = await this.readTransaction(database)

    try {
      const results = hasProjectedProperties(schema)
        ? await new ProjectionService(tx).get<T>(
            constructor,
            schema,
            parameters,
            limit,
            skip,
            order,
          )
        : await new GetService(tx).get<T>(constructor, schema, parameters, limit, skip, order)

      await tx.commit()

      return results
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }
  }

  /**
  Nodes of the given constructor within `distance` of the given point,
  ordered by distance when `order` is 'distance'
  (neode's FindWithinDistance)
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
    const schema = this.getSchema(constructor)

    const tx = await this.readTransaction(database)

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
    const requireModule = createRequire(__filename)

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
  Delete a node. `options` threads the cascade modes through to the
  delete service; the legacy form `delete(entity, database)` — a string
  second argument, as accepted by INeode — is kept working.
  */
  async delete(entity: object, options?: DeleteOptions | string, database?: string): Promise<void> {
    const schema = this.getSchema(constructorOf(entity))

    // A soft delete only SETs a label — the node stays, so it is not a
    // deletion and must not fire NODE_DELETED
    const cascadeOptions: DeleteOptions | undefined =
      typeof options === 'string' ? undefined : options

    const tx = await this.writeTransaction(typeof options === 'string' ? options : database)

    try {
      await new DeleteService(tx).delete(schema, entity, cascadeOptions)

      await tx.commit()
    } catch (error) {
      return await rollbackAfterFailure(tx, error)
    }

    if (cascadeOptions?.soft === undefined || cascadeOptions.soft === '') {
      // Emit event
      this.eventEmitter.emit(EventType.NODE_DELETED, entity)
    }
  }

  /**
  DETACH DELETE every node of the given constructor matching the given
  properties, returning the deleted count (neode's Model.deleteAll,
  extended with a count return)
  */
  async deleteAll(
    constructor: Newable,
    parameters_: Record<string, unknown> = {},
    database?: string,
  ): Promise<number> {
    const schema = this.getSchema(constructor)

    const builder = new Builder().match('n', schema.getLabels())

    // Schema-declared keys only (get() parity): anything else would be raw
    // interpolation into the statement, so unknown keys are ignored
    for (const property of schema.getProperties()) {
      const key = property.getKey()

      if (Object.hasOwn(parameters_, key)) {
        builder.where(`n.${quote(key)}`, parameters_[key])
      }
    }

    const { query, params: parameters } = builder
      .detachDelete('n')
      .return('count(n) AS count')
      .build()

    const output = await this.writeCypher(query, parameters, database)

    const firstRecord = output.records[0]

    if (firstRecord === undefined) {
      throw new NeodeError('count query returned no records')
    }

    return Number(firstRecord.get('count'))
  }

  /**
  Return a new query Builder (neode parity): chain
  `.execute(neode.getConnection())` to run the built statement
  */
  query(): Builder {
    return new Builder()
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
