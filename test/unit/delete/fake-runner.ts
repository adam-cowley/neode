import type { QueryOutput, QueryParams, QueryRecord, Runner } from '../../../src/driver/types.js'

/**
One fake record holding a single column — the deleted-count row the
guarded delete statement returns
*/
class SingleValueRecord implements QueryRecord {
  private readonly value: unknown

  constructor(value: unknown) {
    this.value = value
  }

  get(): unknown {
    return this.value
  }

  has(): boolean {
    return true
  }

  get keys(): string[] {
    return ['deleted']
  }
}

/**
A Runner that captures every statement instead of touching a database,
answering the single-row count shape the guarded delete statement returns.
`deletedCount` plays the database: 0 simulates a guard MATCH that found
nothing.
*/
export class FakeRunner implements Runner {
  readonly statements: { query: string; params: QueryParams }[] = []

  deletedCount = 1

  async run(query: string, params: QueryParams = {}): Promise<QueryOutput> {
    this.statements.push({ query, params })

    const deleted = this.deletedCount

    return { records: [new SingleValueRecord(deleted)] }
  }
}
