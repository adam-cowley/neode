import { classifyError } from './classify.js'
import { NeodeError } from './neode-error.js'

/**
Describe a value's shape without its content — redaction keeps property
values out of error messages (agents see keys, never data).
*/
function describeValue(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  return typeof value
}

/**
The parameters of a failed statement with every value REDACTED: only the
keys and their shapes are shown, never the values themselves
(NTS-446 — error messages are the agent feedback loop, but they must not
leak property values).
*/
export function redactParameters(parameters: Record<string, unknown> | undefined): string {
  const entries = Object.entries(parameters ?? {})

  return entries.length === 0
    ? '(none)'
    : `{ ${entries.map(([key, value]) => `${key}: <redacted ${describeValue(value)}>`).join(', ')} }`
}

/**
Wrap an unclassified driver/engine failure with what failed (the query)
and its REDACTED parameters, keeping the original as `cause` (NTS-446).
Errors classifyError already mapped to the taxonomy (constraint
violations, transient) and other NeodeErrors pass through untouched —
their messages are final.
*/
export function withQueryContext(
  error: unknown,
  statement: string,
  parameters?: Record<string, unknown>,
): unknown {
  const classified = classifyError(error)

  if (classified !== error || classified instanceof NeodeError) {
    return classified
  }

  const why = error instanceof Error ? error.message : String(error)

  return new NeodeError(
    `Cypher query failed — ${why}. Failing statement: ${statement}. ` +
      `Parameters (values redacted): ${redactParameters(parameters)}`,
    { cause: error instanceof Error ? error : undefined },
  )
}
