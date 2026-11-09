// Internal surface (NTS-600): everything the documented public API
// (src/index.ts) deliberately leaves out. In-repo tests and tooling import
// from here; it is not part of the published package exports.
export * from './index.js'

// Registry / validation internals
export { getModel, getModels } from './meta/index.js'
export { validate } from './validation/index.js'
export type { RelationshipCardinality } from './meta/index.js'
export { SyncService } from './services/query/sync.service.js'

// Observers (the documented surface is `neode.observe()`)
export { observe, clearObservers, type ModelObservers, type ObserverContext } from './observers.js'

// Driver / serialisation option plumbing
export type { TransactionOptions } from './transaction/ambient.js'
export { requireRelateClient } from './driver/relate.js'
export type { RelateConnectionOptions } from './driver/relate.js'
export type { ToJsonOptions, RelationshipSerialisationOptions } from './serialise.js'
export type { InstanceLoadLevel } from './entity-methods.js'
export type { HydrateQueryOptions } from './driver/types.js'

// Map-schema rule plumbing
export type { ValidationRules } from './meta/schema-definition.interface.js'

// Graph-type machinery (NTS-549/550/551/578)
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
  GraphTypeCreateOptions,
  GraphTypeConstraintDefinition,
  GraphTypeConstraintKind,
  GraphTypeDefinition,
  GraphTypeNodeDefinition,
  GraphTypeRelationshipDefinition,
  GraphTypePropertyDefinition,
} from './services/schema/graph-type.service.js'

// Model generation from the graph (NTS-164)
export { generateModels } from './services/schema/generate.service.js'
export type {
  GenerateModelsOptions,
  GenerateModelsResult,
  GeneratedModel,
  GeneratedRelationship,
} from './services/schema/generate.service.js'

// Filter plumbing (the read paths' own fragments and per-query option type)
export { readFilterFragment } from './services/query/filters.js'
export type { ReadFilterOptions } from './services/query/filters.js'
export type { FilterDefinition } from './meta/entity/entity-schema.js'

// Index-name helpers
export { vectorIndexName } from './services/schema/vector.service.js'
export { fulltextIndexName } from './services/schema/fulltext.service.js'

// Load-spec / related-read type machinery (NTS-154/497/499/558/560)
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
  ManyAndCount,
  FindManyAndCountOptions,
  StreamOptions,
} from './services/query/paginate.service.js'

// Wipe option plumbing (the documented surface passes literals)
export type { WipeFailure, WipeOptions } from './testing/index.js'
