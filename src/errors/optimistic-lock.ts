import { NeodeError } from './neode-error.js'

/**
Raised when an optimistic-lock check (NTS-158) matched zero rows: the
`@Version` property the instance was hydrated with no longer matches the
stored one — the node was modified or deleted by another transaction.
This is NOT a transient failure: retrying without reloading will fail
again. Reload the entity (find / findById / a fresh get) and re-apply the
change. The stable `name` lets retry helpers exclude it from transient-
retry classification.
*/
export class OptimisticLockError extends NeodeError {
  constructor(modelName: string, options?: ErrorOptions) {
    super(
      `Optimistic lock failed on "${modelName}": the node was modified or deleted by ` +
        'another transaction. Reload the entity and retry the write — ' +
        'retrying without reloading will fail again (the lock guard is not transient).',
      options,
    )

    this.name = 'OptimisticLockError'
  }
}
