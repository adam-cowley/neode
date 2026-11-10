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
  DeleteOptions,
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
  LoadedEntity,
  ManyAndCount,
  OffsetPaginateOptions,
  Ontology,
  OrderSpec,
  Page,
  PaginateOptions,
  ProjectionDirection,
  PropertyDefinition,
  PropertyOntology,
  PropertySchema,
  PropertyTypeName,
  QueryExecutedEvent,
  QueryOutput,
  QueryParams,
  QueryRecord,
  QuerySummary,
  ReadFilterOptions,
  RelatedConfig,
  RelatedManyDefinition,
  RelatedOneDefinition,
  RelationshipConfig,
  RelationshipCountConfig,
  RelationshipCountDefinition,
  RelationshipDefinition,
  RelationshipEdgeRead,
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
  SchemaResult,
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
import { getModel, requireRelateClient, validate, vectorIndexName } from '../../src/index.js'

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
      | 'getModel'
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
      | 'readFilterFragment'
      | 'registerRepository'
      | 'requireRelateClient'
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
      | 'validate'
      | 'valueToJson'
      | 'vectorIndexName'
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
        DeleteOptions,
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
        LoadedEntity<unknown, never>,
        ManyAndCount<unknown>,
        OffsetPaginateOptions,
        Ontology,
        OrderSpec,
        Page<unknown>,
        PaginateOptions,
        ProjectionDirection,
        PropertyDefinition,
        PropertyOntology,
        PropertySchema,
        PropertyTypeName,
        QueryExecutedEvent,
        QueryOutput,
        QueryParams,
        QueryRecord,
        QuerySummary,
        ReadFilterOptions,
        RelatedConfig,
        RelatedManyDefinition,
        RelatedOneDefinition,
        RelationshipConfig,
        RelationshipCountConfig,
        RelationshipCountDefinition,
        RelationshipDefinition,
        RelationshipEdgeRead<unknown>,
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
        SchemaResult,
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

  it('exposes the NTS-601 consumer-facing helpers with their signatures', () => {
    expectTypeOf(validate).toBeFunction()
    expectTypeOf(getModel).toBeFunction()
    expectTypeOf(vectorIndexName).toBeFunction()
    expectTypeOf(requireRelateClient).toBeFunction()
    expectTypeOf(vectorIndexName).parameter(0).toEqualTypeOf<VectorIndexDefinition>()
    expectTypeOf(vectorIndexName).returns.toEqualTypeOf<string>()
  })

  it('exposes the NTS-602 doc-taught result types with their shapes', () => {
    // related(k).withRelationship().find() / .first() rows
    // (docs/decisions/0003-result-shapes.md, NTS-499/566)
    expectTypeOf<RelationshipEdgeRead<{ id: string }>>().toEqualTypeOf<{
      node: { id: string }
      edge: GraphRelationship
    }>()
    // findManyAndCount's `{ items, total }` (docs/decisions/0003-result-shapes.md)
    expectTypeOf<ManyAndCount<{ id: string }>>().toEqualTypeOf<{
      items: { id: string }[]
      total: number
    }>()
    // the with-spec-narrowed read return: no spec = the entity itself
    expectTypeOf<LoadedEntity<{ id: string }, never>>().toEqualTypeOf<{ id: string }>()
    // installSchema()/dropSchema()/applySchemaDrift's result row
    expectTypeOf<SchemaResult['statement']>().toEqualTypeOf<string>()
    expectTypeOf<SchemaResult['success']>().toEqualTypeOf<boolean>()
    expectTypeOf<DeleteOptions['mode']>().toEqualTypeOf<'delete' | 'detach' | undefined>()
  })
})
