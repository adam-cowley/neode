import type {
  CypherOptions,
  HydrateQueryOptions,
  QueryOutput,
  QueryParams as QueryParameters,
} from './driver/types.js'
import type { DeleteOptions } from './services/query/delete.service.js'
import type { OrderSpec } from './services/query/get.service.js'
import type { Builder } from './query/index.js'
import type { ScoredEntity } from './services/query/search.service.js'

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
  findById<T>(
    constructor: new (...arguments_: never[]) => T,
    elementId: string,
    database?: string,
  ): Promise<T | undefined>
  save<T>(entity: T, database?: string): Promise<T>
  delete(entity: object, options?: DeleteOptions | string, database?: string): Promise<void>
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
  ): Promise<T[]>
  /**
  MERGE a node of the given constructor on its merge fields (the unique
  and indexed properties present in `properties` form the match,
  everything else is set) and return the hydrated entity — the seam
  Repository#upsert builds on
  */
  merge<T>(
    constructor: new (...arguments_: never[]) => T,
    properties: Record<string, unknown>,
    database?: string,
  ): Promise<T | undefined>
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
  ): Promise<ScoredEntity<T>[]>
  cypher(query: string, parameters?: QueryParameters, options?: CypherOptions): Promise<QueryOutput>
  cypher<T>(
    query: string,
    parameters: QueryParameters | undefined,
    options: CypherOptions & { hydrate: new (...arguments_: never[]) => T },
  ): Promise<T[]>
}
