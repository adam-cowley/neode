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
    const prefix = this.negative ? 'NOT ' : ''

    return `${prefix}${this.left} ${this.operator} ${this.right}`
  }
}
