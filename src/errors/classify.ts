import { ConstraintViolationError } from './constraint-violation.js'
import { NeodeError } from './neode-error.js'
import { TransientError } from './transient.js'

/**
The status codes every backend raises for a unique-constraint violation:
pre-5.x Neo4j, Neo4j 5.x, and the embedded Relate engine.
*/
const CONSTRAINT_VIOLATION_CODES = new Set([
  'Neo.ClientError.Schema.ConstraintValidation',
  'Neo.ClientError.Schema.ConstraintViolation',
  'Neo.ClientError.Schema.ConstraintValidationFailed',
])

const TRANSIENT_CODE_PREFIX = 'Neo.TransientError.'

/**
Transient-prefixed codes that retrying cannot fix: the transaction was
killed by an operator or timed out server-side (NTS-582). The official
driver's retry predicate excludes the same two.
*/
const NON_RETRYABLE_TRANSIENT_CODES = new Set([
  'Neo.TransientError.Transaction.Terminated',
  'Neo.TransientError.Transaction.LockClientStopped',
])

/**
The driver's connect-failure message shapes ("Failed to connect to
server at …", ECONNREFUSED). These get the connection-config fix
appended — transient mid-session errors keep their raw message (the
config may be blameless).
*/
const CONNECTION_FAILURE = /\bfailed to connect\b|ECONNREFUSED|connection refused/i

/**
Prepend the connection-config fix to a connect-failure message (NTS-442).
The fix sentence never echoes a value — only where to look.
*/
function connectionMessage(message: string): string {
  const why = message.trim().replace(/\.$/, '')

  return (
    `Cannot connect to the database — ${why}. ` +
    'Check that the database is running at the configured URI and that the credentials and database name are correct.'
  )
}

/**
Label/property of a unique violation, parsed from the message:

 - 5.x:  "New node(123) with label `Movie` and property `title` = 'X' ..."
 - 4.x:  "Node(123) already exists with label `Movie` and property `title` = 'X'"

Composite constraints ("and properties `a` = …, `b` = …") parse as the
first property; messages that name no label (the Relate engine names
only the constraint) leave both undefined.
*/
const CONSTRAINT_MESSAGE = /\bwith label `([^`]+)` and propert(?:y|ies) `([^`]+)`/

/**
The classification facts both backends' errors carry: neo4j-driver's
Neo4jError and the Relate client's RelateError both have `code` and
`gqlStatus` (plus a `retryable` verdict).
*/
interface ClassifiedError extends Error {
  code?: unknown
  retryable?: unknown
}

/**
Map a raw driver/engine error to the typed taxonomy (NTS-129):
constraint violations → ConstraintViolationError, transient codes and
retryable-flagged failures → TransientError. Everything else — unknown
shapes and already-typed errors — passes through untouched.
*/
export function classifyError(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof NeodeError) {
    return error
  }

  const raw = error as ClassifiedError
  const code = typeof raw.code === 'string' ? raw.code : undefined

  if (code !== undefined && code !== '' && CONSTRAINT_VIOLATION_CODES.has(code)) {
    const parsed = CONSTRAINT_MESSAGE.exec(error.message)

    return new ConstraintViolationError(error.message, parsed?.[1], parsed?.[2], { cause: error })
  }

  const isTransient = code?.startsWith(TRANSIENT_CODE_PREFIX) === true || raw.retryable === true

  if (!isTransient) {
    return error
  }

  const message = CONNECTION_FAILURE.test(error.message)
    ? connectionMessage(error.message)
    : error.message

  return new TransientError(message, code, { cause: error })
}

/**
Type guard for classified transient errors.
*/
export function isTransientError(error: unknown): error is TransientError {
  return error instanceof TransientError
}

/**
Whether a managed retry may re-run the unit after this error (NTS-582): a
TransientError, except a transaction terminated by an operator / the
server timeout (`Transaction.Terminated`, `Transaction.LockClientStopped`) —
re-running would just be killed again, or defeat the kill.
*/
export function isRetryableError(error: unknown): error is TransientError {
  return isTransientError(error) && !NON_RETRYABLE_TRANSIENT_CODES.has(error.code ?? '')
}
