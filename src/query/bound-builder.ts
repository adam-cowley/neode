import type { QueryParams as QueryParameters, QueryOutput, QueryRecord } from '../driver/types.js'
import type { INeode } from '../neode.interface.js'
import { Builder } from './builder.js'

/**
A Builder bound to an execution scope — the Neode facade or an open
transaction (NTS-554): the plain Builder's fluent surface plus the
.read() / .write() terminals, which build-and-run through Neode#read /
Neode#write (or the TransactionalService mirrors, in-scope). Created by
`neode.query()` / `tx.query()` — the standalone Builder never gains
implicit execution.
*/
export class BoundBuilder extends Builder {
  private readonly scope: INeode

  private readonly database: string | undefined

  constructor(scope: INeode, database?: string) {
    super()

    this.scope = scope
    this.database = database
  }

  /**
  Build and run the statement through the bound scope, routed READ.
  Caller parameters merge over the builder's own params.
  */
  async read(parameters: QueryParameters = {}): Promise<QueryOutput> {
    return this.scope.read(this, parameters, this.database)
  }

  /**
  Build and run the statement through the bound scope, routed WRITE.
  Caller parameters merge over the builder's own params.
  */
  async write(parameters: QueryParameters = {}): Promise<QueryOutput> {
    return this.scope.write(this, parameters, this.database)
  }

  /**
  Build and run the statement through the bound scope, routed READ, and
  return the first row — undefined when the result set is empty (the
  one-row read shape; naming follows Collection#first, NTS-613).
  */
  async first(parameters: QueryParameters = {}): Promise<QueryRecord | undefined> {
    const output = await this.read(parameters)

    return output.records[0]
  }

  /**
  `.first()` narrowed to one column: the named column's value on the
  first row, undefined on an empty result set (the one-row, one-scalar
  read shape, NTS-613).
  */
  async scalar(name: string, parameters: QueryParameters = {}): Promise<unknown> {
    const first = await this.first(parameters)

    return first?.get(name)
  }
}
