import type { CypherOptions, QueryOutput, QueryParams as QueryParameters } from './driver/types.js'
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
  delete(entity: object, database?: string): Promise<void>
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
