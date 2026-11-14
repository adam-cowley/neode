import { NeodeError } from '../errors/neode-error.js'

export const OPERATOR_EQUALS = '='

/**
The operators a ref-to-ref where predicate accepts (NTS-656): the set the
`Where` clause renders over two references — equality, the four orderings
and list membership. `whereProps()` / `whereInRefs()` validate against it.
*/
export const COMPARISON_OPERATORS = ['=', '<>', '<', '<=', '>', '>=', 'IN'] as const

/**
The operator parameter of whereProps(): one of the ref-to-ref comparison
operators (the set the Where clause renders over two references).
*/
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number]

/**
Runtime check for a comparison operator (NTS-656): the type narrows TS
call sites, a dynamic string from JS still fails here with the fix in the
message.
*/
export function assertComparisonOperator(operator: string): ComparisonOperator {
  if (!isComparisonOperator(operator)) {
    throw new NeodeError(
      `Invalid comparison operator ${JSON.stringify(operator)} in whereProps() — ` +
        `supported operators are ${COMPARISON_OPERATORS.join(', ')}. ` +
        'Pass one of those, or whereRaw() for anything else.',
    )
  }

  return operator
}

/**
Type guard over the comparison-operator set.
*/
export function isComparisonOperator(operator: string): operator is ComparisonOperator {
  return (COMPARISON_OPERATORS as readonly string[]).includes(operator)
}

export class Where {
  private negative = false
  private readonly left: string
  private readonly operator: string
  private readonly right: string

  constructor(left: string, operator: string, right: string) {
    this.left = left
    this.operator = operator
    this.right = right
  }

  setNegative(): void {
    this.negative = true
  }

  toString(): string {
    // The compound `NOT IN` operator is rejected by Neo4j 2026.x+ (NTS-476):
    // render the valid `NOT <left> IN $param` form instead. A set `negative`
    // flag (whereNot) cancels the operator's negation rather than doubling it.
    const isInOperator = this.operator.toUpperCase() === 'NOT IN'
    const prefix = this.negative === isInOperator ? '' : 'NOT '
    const operator = isInOperator ? 'IN' : this.operator

    return `${prefix}${this.left} ${operator} ${this.right}`
  }
}
