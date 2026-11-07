import type { Match } from './match.js'
import type { Order } from './order.js'
import { Property } from './property.js'
import type { Relationship } from './relationship.js'

export type SetClause = Property | string

export class Statement {
  private readonly prefix: string = 'MATCH'
  private readonly pattern: (Match | Relationship)[] = []
  private readonly whereClauses: string[] = []
  private readonly orderClauses: Order[] = []
  private readonly detachDeleteValues: string[] = []
  private readonly valuesToDelete: string[] = []
  private readonly returnValues: string[] = []
  private readonly valuesToSet: SetClause[] = []
  private readonly onCreateSetValues: SetClause[] = []
  private readonly onMatchSetValues: SetClause[] = []
  private readonly valuesToRemove: string[] = []
  private readonly callValues: string[] = []

  private limitValue?: number
  private skipValue?: number

  constructor(prefix = 'MATCH') {
    this.prefix = prefix
  }

  match(match: Match | Relationship): this {
    this.pattern.push(match)

    return this
  }

  where(where: string): this {
    this.whereClauses.push(where)

    return this
  }

  limit(limit: number): void {
    this.limitValue = limit
  }

  skip(skip: number): void {
    this.skipValue = skip
  }

  order(order: Order): void {
    this.orderClauses.push(order)
  }

  delete(...values: string[]): this {
    this.valuesToDelete.push(...values)

    return this
  }

  detachDelete(...values: string[]): this {
    this.detachDeleteValues.push(...values)

    return this
  }

  return(...values: string[]): this {
    this.returnValues.push(...values)

    return this
  }

  set(key: string, value: string, operator = '='): this {
    this.valuesToSet.push(new Property(key, value, operator))

    return this
  }

  setRaw(items: SetClause[]): this {
    this.valuesToSet.push(...items)

    return this
  }

  // Raw and parameterised items share one array so a statement mixing both
  // renders a single ON CREATE SET clause (NTS-491) — two clauses is invalid Cypher
  onCreateSetRaw(items: string[]): this {
    this.onCreateSetValues.push(...items)

    return this
  }

  onMatchSetRaw(items: string[]): this {
    this.onMatchSetValues.push(...items)

    return this
  }

  onCreateSet(key: string, value: string, operator = '='): this {
    this.onCreateSetValues.push(new Property(key, value, operator))

    return this
  }

  onMatchSet(key: string, value: string, operator = '='): this {
    this.onMatchSetValues.push(new Property(key, value, operator))

    return this
  }

  remove(items: string[]): this {
    this.valuesToRemove.push(...items)

    return this
  }

  /**
  Raw CALL clause line (e.g. a `db.create.setNodeVectorProperty` vector
  write, NTS-449), rendered after the SET clauses and before DELETE /
  RETURN
  */
  call(line: string): this {
    this.callValues.push(line)

    return this
  }

  toString(shouldIncludePrefix = true): string {
    const output: string[] = []

    if (this.pattern.length > 0) {
      const pattern = this.pattern.map((pattern) => pattern.toString()).join('')

      output.push(shouldIncludePrefix ? `${this.prefix} ${pattern}` : pattern)
    }

    if (this.whereClauses.length > 0) {
      output.push(this.whereClauses.join(''))
    }

    if (this.valuesToRemove.length > 0) {
      output.push(`REMOVE ${this.valuesToRemove.join(', ')}`)
    }

    if (this.onCreateSetValues.length > 0) {
      output.push(
        `ON CREATE SET ${this.onCreateSetValues.map((value) => value.toString()).join(', ')}`,
      )
    }

    if (this.onMatchSetValues.length > 0) {
      output.push(
        `ON MATCH SET ${this.onMatchSetValues.map((value) => value.toString()).join(', ')}`,
      )
    }

    if (this.valuesToSet.length > 0) {
      output.push(`SET ${this.valuesToSet.map((value) => value.toString()).join(', ')}`)
    }

    if (this.callValues.length > 0) {
      output.push(this.callValues.join('\n'))
    }

    if (this.valuesToDelete.length > 0) {
      output.push(`DELETE ${this.valuesToDelete.join(', ')}`)
    }

    if (this.detachDeleteValues.length > 0) {
      output.push(`DETACH DELETE ${this.detachDeleteValues.join(', ')}`)
    }

    if (this.returnValues.length > 0) {
      output.push(`RETURN ${this.returnValues.join(', ')}`)
    }

    if (this.orderClauses.length > 0) {
      output.push(`ORDER BY ${this.orderClauses.map((order) => order.toString()).join(', ')}`)
    }

    if (this.skipValue !== undefined) {
      output.push(`SKIP ${String(this.skipValue)}`)
    }

    if (this.limitValue !== undefined) {
      output.push(`LIMIT ${String(this.limitValue)}`)
    }

    return output.filter((line) => line.length > 0).join('\n')
  }
}
