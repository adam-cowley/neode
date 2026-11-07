import type { TransactionHandle } from '../driver/types.js'

/**
Roll back a transaction after a statement failed, then rethrow the original
error.

A rollback that itself fails must not mask the original error (its type —
ConstraintViolationError, TransientError, … — is what callers handle), but it
must not vanish either: the transaction can stay open server-side until the
server's transaction timeout. So the rollback failure is logged with the fix
and chained onto the original error's `cause` before the original is rethrown.
*/
export async function rollbackAfterFailure(
  tx: TransactionHandle,
  originalError: unknown,
): Promise<never> {
  try {
    await tx.rollback()
  } catch (rollbackError) {
    console.warn(
      '[neode] The statement failed AND rolling its transaction back failed too — the transaction ' +
        'may stay open until the server times it out. Terminate leaked transactions ' +
        '(SHOW TRANSACTIONS, then TERMINATE), and make sure every beginTransaction() is followed ' +
        'by commit() or rollback(). Original error is rethrown below with the rollback failure as its cause.',
      rollbackError,
    )

    if (originalError instanceof Error && originalError.cause === undefined) {
      originalError.cause = rollbackError
    }
  }

  throw originalError
}
