import { assertCount } from './quote.js'
import type { Order } from './order.js'

export class WithStatement {
  private readonly variables: string[]
  private readonly orderClauses: Order[] = []

  private limitValue?: number

  private skipValue?: number

  constructor(variables: string[]) {
    this.variables = variables
  }

  /**
  Append projection items to this clause — the channel an aggregate
  subquery uses to join a WITH clause it shares with carried variables
  (NTS-461)
  */
  append(...variables: string[]): void {
    this.variables.push(...variables)
  }

  order(order: Order): void {
    this.orderClauses.push(order)
  }

  limit(limit: number): void {
    this.limitValue = assertCount(limit, 'limit')
  }

  skip(skip: number): void {
    this.skipValue = assertCount(skip, 'skip')
  }

  toString(): string {
    const output = [`WITH ${this.variables.join(', ')}`]

    if (this.orderClauses.length > 0) {
      output.push(`ORDER BY ${this.orderClauses.map((order) => order.toString()).join(', ')}`)
    }

    if (this.skipValue !== undefined) {
      output.push(`SKIP ${String(this.skipValue)}`)
    }

    if (this.limitValue !== undefined) {
      output.push(`LIMIT ${String(this.limitValue)}`)
    }

    return output.join('\n')
  }
}
