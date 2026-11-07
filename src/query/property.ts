/**
A property in a SET clause: `property operator $param`
or, inline in a pattern, `property: $param`.
*/
export class Property {
  private readonly key: string
  private readonly param: string
  private readonly operator: string = '='

  constructor(key: string, parameter: string, operator = '=') {
    this.key = key
    this.param = `$${parameter}`
    this.operator = operator
  }

  toString(): string {
    return `${this.key} ${this.operator} ${this.param}`.trim()
  }

  toInlineString(): string {
    return `${this.key}: ${this.param}`.trim()
  }
}
