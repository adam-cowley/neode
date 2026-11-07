export class WhereNull {
  private negative = false
  private readonly property: string

  constructor(property: string) {
    this.property = property
  }

  setNegative(): void {
    this.negative = true
  }

  toString(): string {
    const suffix = this.negative ? 'IS NOT NULL' : 'IS NULL'

    return `${this.property} ${suffix}`
  }
}
