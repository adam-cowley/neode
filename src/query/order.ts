export class Order {
  private readonly field: string
  private readonly direction: string

  constructor(field: string, direction = '') {
    this.field = field
    this.direction = direction
  }

  toString(): string {
    return `${this.field} ${this.direction}`.trim()
  }
}
