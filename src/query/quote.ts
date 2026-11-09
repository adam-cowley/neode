import { NeodeError } from '../errors/neode-error.js'

/**
Backtick-quote a Cypher identifier (label, relationship type, property key).

Identifiers cannot be bound as query parameters, so anything that reaches a
statement as an identifier is escaped instead: backticks double (`` `a``b` ``),
which also makes values from outside the schema injection-safe.
*/
export function quote(identifier: string): string {
  return `\`${identifier.replaceAll('`', '``')}\``
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const REFERENCE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/
const DEGREES = /^\d*(\.\.\d*)?$/
const DIRECTIONS = new Set(['ASC', 'ASCENDING', 'DESC', 'DESCENDING'])

/**
Quote a property key only when it is not already a plain identifier, so
declared keys keep their readable `n.name` rendering while hostile ones
(`name} DETACH DELETE x //`) are escaped.
*/
export function safeKey(key: string): string {
  return IDENTIFIER.test(key) ? key : quote(key)
}

/**
`alias.key` with the key escaped as needed (see safeKey).
*/
export function propertyReference(alias: string, key: string): string {
  return `${alias}.${safeKey(key)}`
}

/**
Assert a value is a plain Cypher variable name (alias). Aliases cannot be
escaped without changing meaning, so anything else is rejected.
*/
export function assertAlias(alias: string, where: string): string {
  if (!IDENTIFIER.test(alias)) {
    throw new NeodeError(
      `Invalid alias ${JSON.stringify(alias)} in ${where} — aliases must be plain identifiers ` +
        '([A-Za-z_][A-Za-z0-9_]*). Pass a simple name such as "t1".',
    )
  }

  return alias
}

/**
Assert a value is an alias or a dotted `alias.property` reference.
*/
export function assertReference(reference: string, where: string): string {
  if (!REFERENCE.test(reference)) {
    throw new NeodeError(
      `Invalid reference ${JSON.stringify(reference)} in ${where} — expected an alias or ` +
        'alias.property made of plain identifiers. Pass e.g. "times" or "t1.name".',
    )
  }

  return reference
}

/**
Validate an ORDER BY direction: ASC / DESC (or the long forms), any case,
or empty for none. Returns the normalised upper-case direction.
*/
export function assertDirection(direction: string, where = 'orderBy'): string {
  const normalised = direction.trim().toUpperCase()

  if (normalised !== '' && !DIRECTIONS.has(normalised)) {
    throw new NeodeError(
      `Invalid order direction ${JSON.stringify(direction)} in ${where} — ` +
        'direction must be "ASC" or "DESC". Pass one of those (case-insensitive).',
    )
  }

  return normalised
}

/**
Validate variable-length degrees: `2`, `1..3`, `..3`, `1..`, `..`.
*/
export function assertDegrees(degrees: number | string): string {
  const text = String(degrees)

  if (!DEGREES.test(text)) {
    throw new NeodeError(
      `Invalid relationship degrees ${JSON.stringify(text)} — expected digits with an optional ` +
        '".." range. Pass e.g. 2, "1..3" or "..3".',
    )
  }

  return text
}

/**
LIMIT / SKIP must be a safe non-negative integer: they are interpolated
into the statement, not bound.
*/
export function assertCount(value: number, what: 'limit' | 'skip'): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new NeodeError(
      `Invalid ${what} ${String(value)} in query — ${what} must be a non-negative integer. ` +
        `Pass a whole number >= 0 to ${what}().`,
    )
  }

  return value
}
