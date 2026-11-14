import type {
  ConnectionProvider,
  QueryOutput,
  QueryParams,
  TransactionHandle,
} from '../../../src/driver/types.js'

/**
ConnectionProvider stub scripted with canned outputs, replayed in
statement order — every statement (in-transaction included) recorded.
No database.
*/
export class ScriptedProvider implements ConnectionProvider {
  readonly statements: { query: string; params: QueryParams }[] = []

  private readonly outputs: QueryOutput[]

  constructor(...outputs: QueryOutput[]) {
    this.outputs = outputs
  }

  async run(query: string, params: QueryParams = {}): Promise<QueryOutput> {
    const index = this.statements.length

    this.statements.push({ query, params })

    return this.outputs[index] ?? { records: [] }
  }

  async beginTransaction(): Promise<TransactionHandle> {
    return {
      run: (query, params) => this.run(query, params),
      commit: async () => {},
      rollback: async () => {},
    }
  }

  async edition(): Promise<'unknown'> {
    return 'unknown'
  }

  async close(): Promise<void> {}
}
