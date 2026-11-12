// The curated public surface (NTS-600): only the documented API is
// re-exported here — the Neode facade, decorators, Repository, Builder,
// map-API config helpers, the typed error taxonomy and the functions the
// guides teach. Everything else lives in src/internal.ts and is not part
// of the published type surface.
export { EventType } from './common/events.js'
export { fromEnv } from './from-env.js'
export {
  NeodeError,
  CardinalityViolationError,
  ConstraintViolationError,
  RelationNotLoadedError,
  OptimisticLockError,
  GuardViolationError,
  TransientError,
  classifyError,
  isTransientError,
} from './errors/index.js'
export { ValidationError } from './validation/validation-error.js'
export type { ValidationDetail } from './validation/validation-error.js'
// NTS-601 — plain-payload validation against a model schema, the
// plain-object companion to the documented write path
export { validate } from './validation/index.js'
export { TransactionError } from './transaction/errors.js'
export type { BatchStatementError } from './transaction/errors.js'
export { ParallelError } from './transaction/parallel.js'
export type {
  ParallelBody,
  ParallelMode,
  ParallelOptions,
  ParallelOperationError,
  ParallelRollbackReport,
  ParallelScope,
} from './transaction/parallel.js'
export { Repository } from './repository/index.js'
export { TransactionalService } from './transaction/transactional.service.js'
export { registerRepository, getRepository, resolveRepository } from './meta/repositories.js'
export type { RepositoryConstructor } from './meta/repositories.js'
// NTS-602 — the return type of Repository#getPrimaryKey, named in the API
// reference's repository surface
export type { PropertySchema } from './meta/property-schema.js'
export { mergeRelationshipProperty } from './meta/index.js'
export type { SyncEdgesOptions, SyncEdgesResult } from './services/query/sync.service.js'
export { Collection } from './collection.js'
export { toJson, valueToJson } from './serialise.js'

// Active-record instance methods on hydrated entities (P7.2)
export { applyEntityMethods, setDefaultNeode } from './entity-methods.js'
export type { EntityMethods, WithMethods } from './entity-methods.js'

// Strict relation access (NTS-155)
export { setStrictRelationAccess } from './strict-relation-access.js'
// Deprecation warnings opt-out (NTS-599)
export { setDeprecationWarnings } from './deprecate.js'
export { TraverseBuilder, MAX_TRAVERSE_DEPTH, type Hop, type TraversalRow } from './traverse.js'

// Delete-path cascade depth cap (NTS-595) — the write-side counterpart of
// MAX_TRAVERSE_DEPTH (NTS-593)
export { MAX_CASCADE_DEPTH } from './services/query/delete.service.js'
// NTS-602 — delete()'s options type, named in the facade signature in the
// API reference
export type { DeleteOptions } from './services/query/delete.service.js'
// NTS-648 — detachFrom()'s result type, named in the EntityMethods
// interface in the API reference
export type { DetachResult } from './services/query/detach.service.js'
export type { ReplaceRelationshipOptions } from './services/query/replace-relationship.service.js'
export type { CreateOptions } from './services/query/create.service.js'

// Map-based schema definitions
export {
  defineModel,
  extendModel,
  getModelByName,
  getModelsByName,
} from './meta/map-schema.js'
// NTS-601 — class-based model lookup, companion to the name-based getModelByName
export { getModel } from './meta/index.js'
export type {
  PropertyTypeName,
  PropertyDefinition,
  RelationshipDefinition,
  SchemaDefinition,
  SchemaDefinitionEntry,
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
export type { ComparisonOperator } from './query/index.js'
export type { ShortestPathOptions } from './query/index.js'
export type { INeode } from './neode.interface.js'

// Merge outcome (NTS-630)
export { mergeOutcome, mergeResultFromSave } from './services/query/merge.service.js'
export type { MergeCounts, MergeOutcome, MergeResult } from './services/query/merge.service.js'

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
  TransformedQueryOutput,
  CypherOptions,
  ConnectionOptions,
  GraphNode,
  GraphRelationship,
  AccessMode,
} from './driver/types.js'
export { Neo4jConnectionProvider } from './driver/neo4j-connection-provider.js'
export { RelateConnectionProvider } from './driver/relate.js'
// NTS-601 — embedded Relate client bootstrap used by demo servers
export { requireRelateClient } from './driver/relate.js'

// Raw-cypher helpers + instrumented provider (NTS-122/124/132/133)
export { jsonSafe, jsonSafeRecord } from './driver/json-safe.js'
export { rows } from './driver/rows.js'
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

// NTS-602 — the result shapes of the documented related reads (NTS-566/499),
// taught in docs/decisions/0003-result-shapes.md: the `related(k)
// .withRelationship()` edge rows and the with-spec-narrowed read returns
export type { RelationshipEdgeRead } from './services/query/load-relation.service.js'
export type { LoadedEntity } from './query/load-spec.js'
// NTS-646 — the typed where-filter bag keyed to the model's declared properties
export type {
  WhereFilter,
  WhereFilterLevel,
  FilterOperators,
  FilterOperand,
} from './query/where-filter.js'

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
// NTS-601 — the deterministic vector index naming installSchema() uses and
// the docs already teach
export { vectorIndexName } from './services/schema/vector.service.js'
export { inspectSchema } from './services/schema/inspect.service.js'
export type {
  SchemaInspection,
  SchemaDiff,
  SchemaObject,
  InspectOptions,
} from './services/schema/inspect.service.js'
// NTS-602 — the documented result row of installSchema() / dropSchema(),
// the index services and applySchemaDrift (its shape is spelled out in the
// API reference)
export type { SchemaResult } from './services/schema/schema-objects.js'

// Bulk writes + pagination (NTS-125/126)
export { BulkChunkError, BulkService, rowToProperties } from './services/query/bulk.service.js'
export type {
  BulkChunk,
  BulkOptions,
  BulkRowFailure,
  RelateManyResult,
  RelateManyRow,
  RowPropertiesResult,
  RowToPropertiesOptions,
} from './services/query/bulk.service.js'
export { PaginateService } from './services/query/paginate.service.js'

// Named global filters (NTS-162) — the parameterisation entry points the
// documented filter usage requires
export {
  setFilterParams,
  withFilterParams,
  clearFilterParams,
  WITHOUT_ALL_FILTERS,
  // NTS-614 — the escape hatch for hand-written statements: the raw WHERE
  // fragment + params the read services' hand-written paths compose
  readFilterFragment,
} from './services/query/filters.js'
export type { ReadFilterOptions } from './services/query/filters.js'
export type { OrderSpec } from './query/order-spec.js'
export type {
  Page,
  CursorPage,
  PaginateOptions,
  OffsetPaginateOptions,
  CursorPaginateOptions,
  // NTS-602 — findManyAndCount's documented result shape
  // (docs/decisions/0003-result-shapes.md)
  ManyAndCount,
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
export type { WipeReport, WipeTarget } from './testing/index.js'

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
  ApplySchemaDriftReport,
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

export { Neode } from './neode.service.js'
export { Neode as default } from './neode.service.js'
