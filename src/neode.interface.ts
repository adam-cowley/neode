import type {
  CypherOptions,
  GraphRelationship,
  HydrateQueryOptions,
  QueryOutput,
  QueryParams as QueryParameters,
} from './driver/types.js'
import type { ReadOptions, WithSpec } from './query/load-spec.js'
import type { DeleteOptions } from './services/query/delete.service.js'
import type { OrderSpec } from './services/query/get.service.js'
import type { Builder } from './query/index.js'
import type { ScoredEntity } from './services/query/search.service.js'
import type { MergeResult } from './services/query/merge.service.js'
import type { ReplaceRelationshipOptions } from './services/query/replace-relationship.service.js'

/**
The public API surface of the Neode facade, as implemented by both the
facade (autocommit scope) and TransactionalService (one open transaction).
Accept this type when a function should work over either scope.
*/
export interface INeode {
  find<T>(
    constructor: new (...arguments_: never[]) => T,
    value: string | number,
    database?: string,
  ): Promise<T | undefined>
  /**
  Load spec variant (NTS-560): `options.with` requests non-eager
  relationships per read — `with: { orders: (relation) => relation.orderBy(
  'orderDate', 'DESC').limit(20) }` — hydrated entities included. The
  return contract is unchanged.
  */
  find<T>(
    constructor: new (...arguments_: never[]) => T,
    value: string | number,
    options: ReadOptions<T>,
  ): Promise<T | undefined>
  findById<T>(
    constructor: new (...arguments_: never[]) => T,
    elementId: string,
    database?: string,
  ): Promise<T | undefined>
  save<T>(entity: T, database?: string): Promise<T>
  delete(entity: object, options?: DeleteOptions | string, database?: string): Promise<void>
  /**
  Replace every edge of ONE declared relationship on a node in one
  statement (NTS-634): deletes the relationship's existing edges and
  creates the new set — entity instances or primary-key values — with
  `properties` applied to every created edge. `options.merge` MERGEs the
  new edges instead of CREATEing them. BOTH-direction declarations are
  rejected (match-only, NTS-483).
  */
  replaceRelationship(
    entity: object,
    key: string,
    targets: unknown[],
    properties?: Record<string, unknown>,
    options?: ReplaceRelationshipOptions,
  ): Promise<void>
  /**
  Set the properties of ONE declared relationship's edge (NTS-628): MERGEs
  the edge (never duplicating it) and SETs the properties — idempotent per
  re-run. Validates against the relationship's declared `properties`
  schema when one is declared.
  */
  updateEdgeProperties(
    entity: object,
    key: string,
    target: object,
    properties?: Record<string, unknown>,
  ): Promise<GraphRelationship | undefined>
  /**
  All nodes of the given constructor, optionally filtered/ordered/paged —
  the projection-aware read: models declaring read-model decorators
  (@RelatedOne/@RelationshipCount/…) come back hydrated with their
  projected values (NTS-501)
  */
  all<T>(
    constructor: new (...arguments_: never[]) => T,
    parameters?: Record<string, unknown>,
    order?: OrderSpec,
    limit?: number,
    skip?: number,
    database?: string,
    options?: { with?: WithSpec<T>; withoutFilters?: string[] | undefined },
  ): Promise<T[]>
  /**
  MERGE a node of the given constructor on its merge fields (the unique
  and indexed properties present in `properties` form the match,
  everything else is set) and return the hydrated entity with the write
  outcome (NTS-630) — the seam Repository#upsert builds on
  */
  merge<T>(
    constructor: new (...arguments_: never[]) => T,
    properties: Record<string, unknown>,
    database?: string,
  ): Promise<MergeResult<T> | undefined>
  /**
  MERGE a node on the given match properties, then set the given
  properties (NTS-630): resolves to the hydrated entity with the write
  outcome — `created` when the MERGE created the node, `updated` when it
  matched and wrote, both false on a no-op — plus the aggregated
  counters and the raw driver summary
  */
  mergeOn<T>(
    constructor: new (...arguments_: never[]) => T,
    match: Record<string, unknown>,
    set: Record<string, unknown>,
    database?: string,
  ): Promise<MergeResult<T> | undefined>
  readCypher(query: string, parameters: QueryParameters, database?: string): Promise<QueryOutput>
  writeCypher(query: string, parameters: QueryParameters, database?: string): Promise<QueryOutput>
  /**
  Hydrate variant (NTS-559): the options object as the second argument,
  when there are no parameters to pass.
  */
  read<T>(
    query: Builder | string,
    options: HydrateQueryOptions & { hydrate: new (...arguments_: never[]) => T },
  ): Promise<T[]>
  /**
  Build-and-run sugar (NTS-553): a Builder is built once and run through
  readCypher (READ routing); a string passes straight through. Caller
  parameters merge over the builder's own params.
  */
  read(
    query: Builder | string,
    parameters?: QueryParameters,
    database?: string,
  ): Promise<QueryOutput>
  /**
  Hydrate variant (NTS-559): with a `hydrate` class the rows come back as
  entities of that class, read from the `alias` column ('this' by default)
  — the same overload shape `cypher()` offers.
  */
  read<T>(
    query: Builder | string,
    parameters: QueryParameters | undefined,
    options: HydrateQueryOptions & { hydrate: new (...arguments_: never[]) => T },
  ): Promise<T[]>
  /**
  WRITE counterpart of read().
  */
  /**
  Hydrate variant (NTS-559): the options object as the second argument,
  when there are no parameters to pass.
  */
  write<T>(
    query: Builder | string,
    options: HydrateQueryOptions & { hydrate: new (...arguments_: never[]) => T },
  ): Promise<T[]>
  write(
    query: Builder | string,
    parameters?: QueryParameters,
    database?: string,
  ): Promise<QueryOutput>
  /**
  Hydrate variant (NTS-559): with a `hydrate` class the rows come back as
  entities of that class, read from the `alias` column ('this' by default).
  */
  write<T>(
    query: Builder | string,
    parameters: QueryParameters | undefined,
    options: HydrateQueryOptions & { hydrate: new (...arguments_: never[]) => T },
  ): Promise<T[]>
  search<T>(
    constructor: new (...arguments_: never[]) => T,
    indexName: string,
    query: string,
    limit?: number,
    filters?: { withoutFilters?: string[] | undefined },
    database?: string,
  ): Promise<ScoredEntity<T>[]>
  cypher(
    query: string,
    parameters?: QueryParameters,
    options?: Omit<CypherOptions, 'hydrate'>,
  ): Promise<QueryOutput>
  cypher<T>(
    query: string,
    parameters: QueryParameters | undefined,
    options: CypherOptions & { hydrate: new (...arguments_: never[]) => T },
  ): Promise<T[]>
}
