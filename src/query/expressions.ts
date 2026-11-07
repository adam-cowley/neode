/**
Leaf Cypher expression helpers.

Statement structure lives in Builder (match / where / call / unwind …);
these helpers only compose single expressions for RETURN / SET / WHERE
positions, so repositories never assemble hand-written clause strings.
Every value a caller supplies must be bound as a parameter (`$name`) —
these helpers interpolate structure, never data.
*/
const expressions = {
  coalesce: (...values: string[]): string => `coalesce(${values.join(', ')})`,
  toString: (expression: string): string => `toString(${expression})`,
  datetime: (expression?: string): string =>
    expression === undefined || expression === '' ? 'datetime()' : `datetime(${expression})`,
  randomUUID: (): string => 'randomUUID()',
  size: (expression: string): string => `size(${expression})`,
  head: (expression: string): string => `head(${expression})`,
  last: (expression: string): string => `last(${expression})`,
  exists: (expression: string): string => `exists(${expression})`,
  isEmpty: (expression: string): string => `isEmpty(${expression})`,
  trim: (expression: string): string => `trim(${expression})`,
  count: (expression = '*'): string => `count(${expression})`,
  countDistinct: (expression: string): string => `count(DISTINCT ${expression})`,
  sum: (expression: string): string => `sum(${expression})`,
  any: (variable: string, list: string, predicate: string): string =>
    `any(${variable} IN ${list} WHERE ${predicate})`,
  all: (variable: string, list: string, predicate: string): string =>
    `all(${variable} IN ${list} WHERE ${predicate})`,
  /**
  Pattern comprehension: `[(a)-[:REL]->(b) | b.prop]` — the pattern is
  composed from fragments, the projection is an expression
  */
  listComprehension: (pattern: string, projection: string): string =>
    `[${pattern} | ${projection}]`,
  /**
  APOC helpers used by the GraphAcademy port (apoc.coll / apoc.text)
  */
  apocCollToSet: (expression: string): string => `apoc.coll.toSet(${expression})`,
  apocBase64Encode: (expression: string): string => `apoc.text.base64Encode(${expression})`,
}

export { expressions as expr }

/**
CASE expression: `CASE WHEN c1 THEN t1 [WHEN …] [ELSE fallback] END`.
Conditions and results are Cypher expressions composed by the caller.
*/
function caseExpression(pairs: { when: string; then: string }[], fallback?: string): string {
  const parts = pairs.map((pair) => `WHEN ${pair.when} THEN ${pair.then}`)

  if (fallback !== undefined) {
    parts.push(`ELSE ${fallback}`)
  }

  return `CASE ${parts.join(' ')} END`
}

export { caseExpression as caseExpr }

/**
A raw Cypher expression used as an inline pattern property value
(NTS-460): rendered verbatim into the pattern — `{ prop: <expression> }`
— instead of being bound as a parameter. Variable references
(`row.answers`), server-side calls (`datetime()`) and parameter
references (`$name`, bound via `Builder#param`) are all legal; the
expression must never interpolate data.
*/
export class RawExpression {
  private readonly expression: string

  constructor(expression: string) {
    this.expression = expression
  }

  toString(): string {
    return this.expression
  }
}
