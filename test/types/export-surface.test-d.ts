/**
 * NTS-600 — the curated public export surface is EXACT: the package root
 * exports exactly the value set asserted below (plus the type surface
 * asserted further down). A symbol added to the root export must be added
 * to this list deliberately — that is the curation contract.
 */
import { describe, expectTypeOf, it } from 'vitest'
import type {
  AccessMode,
  ApplySchemaDiffOptions,
  BatchStatementError,
  BulkChunk,
  BulkOptions,
  ComputedDefinition,
  ConnectionOptions,
  ConnectionProvider,
  ConnectivityConfig,
  CursorPage,
  CursorPaginateOptions,
  CypherOptions,
  EntityMethods,
  EntityOntology,
  ExpressionDefinition,
  FactoryWithSpec,
  FulltextIndexDefinition,
  GraphNode,
  GraphRelationship,
  Hop,
  INeode,
  InspectOptions,
  KnnMode,
  LabelPresentDefinition,
  OffsetPaginateOptions,
  Ontology,
  OrderSpec,
  Page,
  PaginateOptions,
  ProjectionDirection,
  PropertyDefinition,
  PropertyOntology,
  PropertyTypeName,
  QueryExecutedEvent,
  QueryOutput,
  QueryParams,
  QueryRecord,
  QuerySummary,
  RelatedConfig,
  RelatedManyDefinition,
  RelatedOneDefinition,
  RelationshipConfig,
  RelationshipCountConfig,
  RelationshipCountDefinition,
  RelationshipDefinition,
  RelationshipExistsConfig,
  RelationshipExistsDefinition,
  RelationshipOntology,
  RepositoryConstructor,
  RunCypherScriptOptions,
  Runner,
  SchemaDefinition,
  SchemaDefinitionEntry,
  SchemaDiff,
  SchemaDrift,
  SchemaDriftEntry,
  SchemaDriftGroup,
  SchemaInspection,
  SchemaObject,
  ScoredEntity,
  SyncEdgesOptions,
  SyncEdgesResult,
  TransactionHandle,
  TransformConfig,
  TraversalRow,
  ValidationDetail,
  VectorConfig,
  VectorIndexDefinition,
  WaitUntilReachableOptions,
  WipeReport,
  WipeTarget,
  WithMethods,
} from '../../src/index.js'

type Root = typeof import('../../src/index.js')

describe('public export surface (NTS-600)', () => {
  it('exports exactly the documented value surface', () => {
    expectTypeOf<keyof Root>().toEqualTypeOf<
      | 'Boolean'
      | 'BoundBuilder'
      | 'Builder'
      | 'BulkService'
      | 'CardinalityViolationError'
      | 'Collection'
      | 'Computed'
      | 'ConnectivityTimeoutError'
      | 'ConstraintViolationError'
      | 'CreatedAt'
      | 'Date'
      | 'DateTime'
      | 'Default'
      | 'Derived'
      | 'Direction'
      | 'Duration'
      | 'EndNode'
      | 'EntityRepository'
      | 'EventType'
      | 'Expression'
      | 'FactoryBuilder'
      | 'Filter'
      | 'Float'
      | 'FulltextIndexService'
      | 'Hidden'
      | 'Index'
      | 'InternalId'
      | 'LabelPredicate'
      | 'LabelPresent'
      | 'LocalDateTime'
      | 'LocalTime'
      | 'MAX_CASCADE_DEPTH'
      | 'MAX_TRAVERSE_DEPTH'
      | 'Neo4jConnectionProvider'
      | 'Neode'
      | 'NeodeError'
      | 'NodeEntity'
      | 'Number'
      | 'OnCreateSet'
      | 'OnMatchSet'
      | 'OneToMany'
      | 'OneToOne'
      | 'OptimisticLockError'
      | 'OtherNode'
      | 'PaginateService'
      | 'Point'
      | 'Primary'
      | 'ProjectionService'
      | 'Property'
      | 'Protected'
      | 'RawExpression'
      | 'Readonly'
      | 'RelateConnectionProvider'
      | 'RelatedMany'
      | 'RelatedOne'
      | 'RelationNotLoadedError'
      | 'RelationshipCount'
      | 'RelationshipEntity'
      | 'RelationshipExists'
      | 'Repository'
      | 'Required'
      | 'Seeder'
      | 'SoftDelete'
      | 'StartNode'
      | 'String'
      | 'Time'
      | 'TransactionError'
      | 'TransactionalService'
      | 'TransientError'
      | 'TraverseBuilder'
      | 'Unique'
      | 'UpdatedAt'
      | 'Uuid'
      | 'ValidationError'
      | 'Vector'
      | 'VectorIndexService'
      | 'Version'
      | 'WITHOUT_ALL_FILTERS'
      | 'WhereNull'
      | 'applyEntityMethods'
      | 'applySchemaDrift'
      | 'caseExpr'
      | 'classifyError'
      | 'clearFilterParams'
      | 'default'
      | 'defineModel'
      | 'expr'
      | 'extendModel'
      | 'formatSchemaDrift'
      | 'fromEnv'
      | 'getModelByName'
      | 'getModelsByName'
      | 'getRepository'
      | 'hasProjectedProperties'
      | 'hydrate'
      | 'hydrateFirst'
      | 'hydrateProjection'
      | 'inspectSchema'
      | 'instrumentConnectionProvider'
      | 'isTransientError'
      | 'jsonSafe'
      | 'jsonSafeRecord'
      | 'knn'
      | 'mergeRelationshipProperty'
      | 'ontology'
      | 'ontologyMarkdown'
      | 'projectionNode'
      | 'registerRepository'
      | 'resolveRepository'
      | 'runCypherScript'
      | 'runSeeders'
      | 'schemaDrift'
      | 'search'
      | 'seededRandom'
      | 'setDefaultNeode'
      | 'setDeprecationWarnings'
      | 'setFilterParams'
      | 'setStrictRelationAccess'
      | 'splitCypherStatements'
      | 'testId'
      | 'toCollection'
      | 'toDirection'
      | 'toFulltextQuery'
      | 'toJson'
      | 'valueToJson'
      | 'verifyConnectivity'
      | 'waitUntilReachable'
      | 'wipe'
      | 'withFilterParams'
    >()
  })

  it('exports the documented type surface', () => {
    expectTypeOf<
      [
        AccessMode,
        ApplySchemaDiffOptions,
        BatchStatementError,
        BulkChunk<unknown>,
        BulkOptions,
        ComputedDefinition,
        ConnectionOptions,
        ConnectionProvider,
        ConnectivityConfig,
        CursorPage<unknown>,
        CursorPaginateOptions,
        CypherOptions,
        EntityMethods,
        EntityOntology,
        ExpressionDefinition,
        FactoryWithSpec,
        FulltextIndexDefinition,
        GraphNode,
        GraphRelationship,
        Hop,
        INeode,
        InspectOptions,
        KnnMode,
        LabelPresentDefinition,
        OffsetPaginateOptions,
        Ontology,
        OrderSpec,
        Page<unknown>,
        PaginateOptions,
        ProjectionDirection,
        PropertyDefinition,
        PropertyOntology,
        PropertyTypeName,
        QueryExecutedEvent,
        QueryOutput,
        QueryParams,
        QueryRecord,
        QuerySummary,
        RelatedConfig,
        RelatedManyDefinition,
        RelatedOneDefinition,
        RelationshipConfig,
        RelationshipCountConfig,
        RelationshipCountDefinition,
        RelationshipDefinition,
        RelationshipExistsConfig,
        RelationshipExistsDefinition,
        RelationshipOntology,
        RepositoryConstructor,
        RunCypherScriptOptions,
        Runner,
        SchemaDefinition,
        SchemaDefinitionEntry,
        SchemaDiff,
        SchemaDrift,
        SchemaDriftEntry,
        SchemaDriftGroup,
        SchemaInspection,
        SchemaObject,
        ScoredEntity<unknown>,
        SyncEdgesOptions,
        SyncEdgesResult,
        TransactionHandle,
        TransformConfig,
        TraversalRow,
        ValidationDetail,
        VectorConfig,
        VectorIndexDefinition,
        WaitUntilReachableOptions,
        WipeReport,
        WipeTarget,
        WithMethods<unknown>,
      ]
    >().toExtend<unknown[]>()
  })
})
