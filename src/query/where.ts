export const OPERATOR_EQUALS = '='

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
