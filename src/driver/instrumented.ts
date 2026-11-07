import type { QueryExecutedEvent } from '../common/events.js'
import type {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams as QueryParameters,
  TransactionHandle,
} from './types.js'

/**
Listener invoked once per executed statement — successful or not.
*/
export type QueryExecutedListener = (event: QueryExecutedEvent) => void

function instrumentRun(
  run: (statement: string, parameters?: QueryParameters) => Promise<QueryOutput>,
  onQuery: QueryExecutedListener,
  database?: string,
): (statement: string, parameters?: QueryParameters) => Promise<QueryOutput> {
  return async (statement, parameters) => {
    const start = performance.now()

    try {
      return await run(statement, parameters)
    } finally {
      onQuery({
        cypher: statement,
        params: parameters ?? {},
        duration: performance.now() - start,
        database,
      })
    }
  }
}

/**
A ConnectionProvider forwarding to `inner` and reporting every executed
statement — implicit and inside transactions — to `onQuery`. This is the
shared runner chokepoint the `query:executed` lifecycle event emits from.
*/
export class InstrumentedConnectionProvider implements ConnectionProvider {
  private readonly inner: ConnectionProvider
  private readonly onQuery: QueryExecutedListener

  constructor(inner: ConnectionProvider, onQuery: QueryExecutedListener) {
    this.inner = inner
    this.onQuery = onQuery
  }

  async run(
    statement: string,
    parameters?: QueryParameters,
    mode?: AccessMode,
    database?: string,
  ): Promise<QueryOutput> {
    return instrumentRun(
      async (cypher, parameters_) => this.inner.run(cypher, parameters_, mode, database),
      this.onQuery,
      database,
    )(statement, parameters)
  }

  async beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle> {
    const handle = await this.inner.beginTransaction(mode, database)

    return {
      run: instrumentRun(
        async (statement, parameters) => handle.run(statement, parameters),
        this.onQuery,
        database,
      ),
      commit: async () => handle.commit(),
      rollback: async () => handle.rollback(),
    }
  }

  async edition(): Promise<'enterprise' | 'community' | 'unknown'> {
    return this.inner.edition()
  }

  async close(): Promise<void> {
    return this.inner.close()
  }
}

/**
Instrument a provider transparently: property reads the wrapper doesn't
satisfy — duck-typed introspection such as `connection.database` on the
neo4j provider — forward to the inner provider, so consumers holding
`Neode#getConnection()` see through the instrumentation.
*/
export function instrumentConnectionProvider(
  inner: ConnectionProvider,
  onQuery: QueryExecutedListener,
): ConnectionProvider {
  return new Proxy(new InstrumentedConnectionProvider(inner, onQuery), {
    get(target, property, receiver) {
      const value: unknown = Reflect.has(target, property)
        ? Reflect.get(target, property, receiver)
        : Reflect.get(inner, property, receiver)

      return value
    },
  })
}
