import type { Order } from './order.js'

export class WithStatement {
  private readonly variables: string[]
  private readonly orderClauses: Order[] = []

  private limitValue?: number

  constructor(variables: string[]) {
    this.variables = variables
  }

  order(order: Order): void {
    this.orderClauses.push(order)
  }

  limit(limit: number): void {
    this.limitValue = limit
  }

  toString(): string {
    const output = [`WITH ${this.variables.join(', ')}`]

    if (this.orderClauses.length > 0) {
      output.push(`ORDER BY ${this.orderClauses.map((order) => order.toString()).join(', ')}`)
    }

    if (this.limitValue !== undefined) {
      output.push(`LIMIT ${String(this.limitValue)}`)
    }

    return output.join('\n')
  }
}
