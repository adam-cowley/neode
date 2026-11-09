export { EventType } from './common/events.js'
export { fromEnv } from './from-env.js'
export {
  NeodeError,
  ConstraintViolationError,
  RelationNotLoadedError,
  OptimisticLockError,
  TransientError,
  classifyError,
  isTransientError,
} from './errors/index.js'
export { ValidationError } from './validation/validation-error.js'
export type { ValidationDetail } from './validation/validation-error.js'
export { TransactionError } from './transaction/errors.js'
export type { BatchStatementError } from './transaction/errors.js'
export { Repository } from './repository/index.js'
export { TransactionalService } from './transaction/transactional.service.js'
export type { TransactionOptions } from './transaction/ambient.js'
export { registerRepository, getRepository, resolveRepository } from './meta/repositories.js'
export { getModel, getModels } from './meta/index.js'
export { validate } from './validation/index.js'
export { mergeRelationshipProperty } from './meta/index.js'
export type { RepositoryConstructor } from './meta/repositories.js'
export { Collection } from './collection.js'
export { toJson, valueToJson } from './serialise.js'

// Active-record instance methods on hydrated entities (P7.2)
export { applyEntityMethods, setDefaultNeode } from './entity-methods.js'
export type { EntityMethods, InstanceLoadLevel, WithMethods } from './entity-methods.js'

// Strict relation access (NTS-155)
export { setStrictRelationAccess } from './strict-relation-access.js'
export { observe, clearObservers, type ModelObservers, type ObserverContext } from './observers.js'
export { TraverseBuilder, type Hop, type TraversalRow } from './traverse.js'

// Map-based schema definitions
export {
  defineModel,
  extendModel,
  getModelByName,
  getModelsByName,
} from './meta/map-schema.js'
export type {
  PropertyTypeName,
  PropertyDefinition,
  RelationshipDefinition,
  SchemaDefinition,
  SchemaDefinitionEntry,
  ValidationRules,
} from './meta/schema-definition.interface.js'

// Query builder
export {
  Builder,
  BoundBuilder,
  Direction,
  toDirection,
  expr,
  caseExpr,
  RawExpression,
} from './query/index.js'
export type { INeode } from './neode.interface.js'

// Hydration of raw query results (P4.11 parity)
export { hydrate, hydrateFirst, toCollection } from './hydrate.js'

// Database drivers
export type {
  ConnectionProvider,
  TransactionHandle,
  Runner,
  QueryOutput,
  QueryRecord,
  QueryParams,
  QuerySummary,
  CypherOptions,
  HydrateQueryOptions,
  ConnectionOptions,
  GraphNode,
  GraphRelationship,
  AccessMode,
} from './driver/types.js'
export { Neo4jConnectionProvider } from './driver/neo4j-connection-provider.js'
export { RelateConnectionProvider, requireRelateClient } from './driver/relate.js'

// Raw-cypher helpers + instrumented provider (NTS-122/124/132/133)
export { jsonSafe, jsonSafeRecord } from './driver/json-safe.js'
export { instrumentConnectionProvider } from './driver/instrumented.js'
export type { QueryExecutedEvent } from './common/events.js'

// Read-model projections (NTS-135/136/137/138)
export {
  ProjectionService,
  projectionNode,
  hasProjectedProperties,
  hydrateProjection,
} from './projection/index.js'
export type {
  RelatedOneDefinition,
  RelatedManyDefinition,
  RelationshipCountDefinition,
  RelationshipExistsDefinition,
  LabelPresentDefinition,
  ExpressionDefinition,
  ComputedDefinition,
} from './meta/schema-definition.interface.js'

// Full-text + vector search (NTS-123/127)
export { search } from './services/query/search.service.js'
export type { ScoredEntity } from './services/query/search.service.js'
export { knn } from './services/query/knn.service.js'
export type { KnnMode } from './services/query/knn.service.js'
export { toFulltextQuery } from './services/index-support/lucene.js'
export { FulltextIndexService } from './services/schema/fulltext.service.js'
export type { FulltextIndexDefinition } from './services/schema/fulltext.service.js'
export { VectorIndexService } from './services/schema/vector.service.js'
export type { VectorIndexDefinition } from './services/schema/vector.service.js'
export {
  GraphTypeService,
  currentGraphType,
  deriveGraphType,
  deriveGraphTypeElementsOnly,
  graphTypeAddStatement,
  graphTypeAlterStatement,
  graphTypeConstraintName,
  graphTypeSetStatement,
  graphTypeDropStatement,
  parseGraphTypeSpecification,
} from './services/schema/graph-type.service.js'
export type {
  GraphTypeConstraintDefinition,
  GraphTypeConstraintKind,
  GraphTypeDefinition,
  GraphTypeNodeDefinition,
  GraphTypeRelationshipDefinition,
  GraphTypePropertyDefinition,
} from './services/schema/graph-type.service.js'
export { inspectSchema } from './services/schema/inspect.service.js'
export type {
  SchemaInspection,
  SchemaDiff,
  SchemaObject,
  InspectOptions,
} from './services/schema/inspect.service.js'

// Bulk writes + pagination (NTS-125/126)
export { BulkService } from './services/query/bulk.service.js'
export type { BulkChunk, BulkOptions } from './services/query/bulk.service.js'
export { PaginateService } from './services/query/paginate.service.js'

// Named global filters (NTS-162)
export {
  setFilterParams,
  clearFilterParams,
  readFilterFragment,
  WITHOUT_ALL_FILTERS,
} from './services/query/filters.js'
export type { ReadFilterOptions } from './services/query/filters.js'
export type { FilterDefinition } from './meta/entity/entity-schema.js'
export { vectorIndexName } from './services/schema/vector.service.js'
export { fulltextIndexName } from './services/schema/fulltext.service.js'
export type { OrderSpec } from './query/order-spec.js'
export type {
  EdgeFindResult,
  RelatedQuery,
  RelatedScope,
  RelationshipEdgeRead,
} from './services/query/load-relation.service.js'
export type {
  DeclaredRelationships,
  LoadOptions,
  LoadedEntity,
  LoadSpec,
  QueryLoadLevel,
  QueryLoadSpec,
  ReadOptions,
  RelationQuery,
  WithSpec,
} from './query/load-spec.js'
export type {
  Page,
  CursorPage,
  PaginateOptions,
  OffsetPaginateOptions,
  CursorPaginateOptions,
  ManyAndCount,
  FindManyAndCountOptions,
  StreamOptions,
} from './services/query/paginate.service.js'

// Ops helpers + consumer test utilities (NTS-130/134/146)
export {
  verifyConnectivity,
  waitUntilReachable,
  ConnectivityTimeoutError,
  splitCypherStatements,
  runCypherScript,
} from './ops/index.js'
export type {
  ConnectivityConfig,
  WaitUntilReachableOptions,
  RunCypherScriptOptions,
} from './ops/index.js'
export { wipe, testId, seededRandom, Seeder, runSeeders } from './testing/index.js'
export type { WipeTarget } from './testing/index.js'

// Query builder additions (NTS-143/144/128)
export { WhereNull, LabelPredicate } from './query/index.js'

// Schema drift workflow (NTS-450)
export {
  schemaDrift,
  formatSchemaDrift,
  applySchemaDrift,
} from './services/schema/drift.service.js'
export type {
  SchemaDrift,
  SchemaDriftGroup,
  SchemaDriftEntry,
  ApplySchemaDiffOptions,
} from './services/schema/drift.service.js'

// Agent ontology (NTS-445)
export { ontology, ontologyMarkdown } from './meta/ontology.js'
export type {
  Ontology,
  EntityOntology,
  PropertyOntology,
  RelationshipOntology,
} from './meta/ontology.js'

// Factories & seeding (NTS-444)
export { FactoryBuilder } from './services/factory.service.js'
export type { FactoryWithSpec } from './services/factory.service.js'

// Vector model metadata (NTS-447)
export type { VectorConfig } from './meta/schema-definition.interface.js'

// Embedding transforms (NTS-449)
export type { TransformConfig } from './meta/schema-definition.interface.js'

export * from './decorators/index.js'

export { Neode as default } from './neode.service.js'
