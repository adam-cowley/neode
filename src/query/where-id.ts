export class WhereId {
  private negative = false
  private readonly alias: string
  private readonly param: string

  constructor(alias: string, parameter: string) {
    this.alias = alias
    this.param = parameter
  }

  setNegative(): void {
    this.negative = true
  }

  toString(): string {
    const prefix = this.negative ? 'NOT ' : ''

    return `${prefix}elementId(${this.alias}) = $${this.param}`
  }
}
