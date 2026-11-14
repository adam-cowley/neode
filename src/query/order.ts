import { assertDirection } from './quote.js'

export class Order {
  private readonly field: string
  private readonly direction: string

  constructor(field: string, direction = '') {
    this.field = field
    this.direction = assertDirection(direction)
  }

  toString(): string {
    return `${this.field} ${this.direction}`.trim()
  }
}
