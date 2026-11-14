import { NeodeError } from './neode-error.js'

/**
Raised when a guarded increment (NTS-655) matched zero rows: the
`min` floor passed to `Repository#increment` renders as a
`WITH … WHERE` terminal in the decrement's own statement, and a
post-write value below the floor filters the statement's only row out.
A missing entity matches zero rows too — the two cases cannot be told
apart inside one statement. The throw is what rolls the write back:
run guarded increments inside a managed write transaction
(`inWriteTransaction` / ambient transaction). The stable `name` lets
retry helpers exclude it from transient-retry classification.
*/
export class GuardViolationError extends NeodeError {
  constructor(modelName: string, property: string, min: number, options?: ErrorOptions) {
    super(
      `Increment guard violated on "${modelName}.${property}" — the post-write value would ` +
        `drop below the min floor of ${String(min)}. The statement matched zero rows (a missing entity ` +
        'matches zero rows too). Run the increment inside a managed write transaction ' +
        '(inWriteTransaction) so the violation rolls the whole unit back, or lower the floor.',
      options,
    )

    this.name = 'GuardViolationError'
  }
}
