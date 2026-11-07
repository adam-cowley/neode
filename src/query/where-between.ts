export class WhereBetween {
  private negative = false
  private readonly alias: string
  private readonly floor: string
  private readonly ceiling: string

  constructor(alias: string, floor: string, ceiling: string) {
    this.alias = alias
    this.floor = floor
    this.ceiling = ceiling
  }

  setNegative(): void {
    this.negative = true
  }

  toString(): string {
    const prefix = this.negative ? 'NOT ' : ''

    return `${prefix}$${this.floor} <= ${this.alias} <= $${this.ceiling}`
  }
}
