/**
A property in a SET clause: `property operator $param`
or, inline in a pattern, `property: $param`.
With `isRaw`, the value renders verbatim (an inline Cypher
expression, NTS-460) instead of a parameter reference.
*/
export class Property {
  private readonly key: string
  private readonly param: string
  private readonly operator: string = '='

  constructor(key: string, parameter: string, operator = '=', isRaw = false) {
    this.key = key
    this.param = isRaw ? parameter : `$${parameter}`
    this.operator = operator
  }

  toString(): string {
    return `${this.key} ${this.operator} ${this.param}`.trim()
  }

  toInlineString(): string {
    return `${this.key}: ${this.param}`.trim()
  }
}
