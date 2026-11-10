/**
A property in a SET clause: `property operator $param`
or, inline in a pattern, `property: $param`.
With `isRaw`, the value renders verbatim (an inline Cypher
expression, NTS-460) instead of a parameter reference.
*/
import { safeKey } from './quote.js'

export class Property {
  private readonly key: string
  private readonly param: string
  private readonly operator: string = '='
  /**
  True when the value renders verbatim (an inline Cypher expression)
  */
  private readonly isRawValue: boolean

  constructor(key: string, parameter: string, operator = '=', isRaw = false) {
    this.key = key
    this.param = isRaw ? parameter : `$${parameter}`
    this.operator = operator
    this.isRawValue = isRaw
  }

  get isRaw(): boolean {
    return this.isRawValue
  }

  toString(): string {
    // Keys arrive as composed references (`alias.key` from the write
    // services, a bare alias with `+=`) — quote only the trailing
    // property-key segment; a caller-pre-quoted segment passes through
    // (NTS-605)
    const dot = this.key.indexOf('.')
    const reference = dot === -1 ? '' : this.key.slice(0, dot + 1)
    const tail = dot === -1 ? this.key : this.key.slice(dot + 1)

    return `${reference}${tail.includes('`') ? tail : safeKey(tail)} ${this.operator} ${this.param}`.trim()
  }

  toInlineString(): string {
    return `${safeKey(this.key)}: ${this.param}`.trim()
  }
}
