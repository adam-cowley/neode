import type { QueryOutput, QueryParams as QueryParameters } from '../driver/types.js'
import { NeodeError } from '../errors/neode-error.js'

export const ERROR_TRANSACTION_FAILED = 'ERROR_TRANSACTION_FAILED'

/**
A single failed statement within a batch.
*/
export interface BatchStatementError {
  /**
  Zero-based position of the statement in the batch
  */
  index: number
  query: string
  params: QueryParameters
  error: unknown
}

/**
Thrown by Neode.runAll() (v3's batch(), NTS-624) when any statement of
the batch fails and the
transaction is rolled back (port of neode's TransactionError):

 - `errors`  — per-statement error aligned with the input batch, null
               where the statement succeeded
 - `results` — results of the statements that succeeded before the failure
 - `details` — the failed statements only ({ index, query, params, error })
*/
export class TransactionError extends NeodeError {
  readonly errors: (BatchStatementError | null)[]
  readonly results: QueryOutput[]
  readonly details: BatchStatementError[]

  constructor(
    errors: (BatchStatementError | null)[],
    results: QueryOutput[],
    details: BatchStatementError[],
  ) {
    super(
      `${ERROR_TRANSACTION_FAILED}: failed statement(s) ` +
        details.map((statement) => statement.index).join(', '),
    )

    this.name = 'TransactionError'

    this.errors = errors
    this.results = results
    this.details = details
  }
}
