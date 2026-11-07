/**
Backtick-quote a Cypher identifier (label, relationship type, property key).

Identifiers cannot be bound as query parameters, so anything that reaches a
statement as an identifier is escaped instead: backticks double (`` `a``b` ``),
which also makes values from outside the schema injection-safe.
*/
export function quote(identifier: string): string {
  return `\`${identifier.replaceAll('`', '``')}\``
}
