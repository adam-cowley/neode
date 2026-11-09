import type { Match } from './match.js'
import type { Order } from './order.js'
import { Property } from './property.js'
import { assertCount } from './quote.js'
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
  private pathVariable?: string
  private distinctReturn = false

  private limitValue?: number
  private skipValue?: number

  constructor(prefix = 'MATCH') {
    this.prefix = prefix
  }

  match(match: Match | Relationship): this {
    this.pattern.push(match)

    return this
  }

  /**
  Bind the segment's whole pattern to a path variable (`MATCH p = <pattern>`,
  NTS-593) — the handle variable-length hops read their mid-path nodes
  through (`all(n IN tail(nodes(p)) WHERE …)`)
  */
  asPath(variable: string): this {
    this.pathVariable = variable

    return this
  }

  where(where: string): this {
    this.whereClauses.push(where)

    return this
  }

  limit(limit: number): void {
    this.limitValue = assertCount(limit, 'limit')
  }

  skip(skip: number): void {
    this.skipValue = assertCount(skip, 'skip')
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

  /**
  `RETURN DISTINCT <values>` (NTS-593): variable-length hops fan out one row
  per path — DISTINCT collapses the paths that reach the same nodes
  */
  returnDistinct(...values: string[]): this {
    this.distinctReturn = true

    return this.return(...values)
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

      // The path binding is part of the MATCH keyword form — a bare pattern
      // (pattern()) renders without it
      const binding =
        shouldIncludePrefix && this.pathVariable !== undefined ? `${this.pathVariable} = ` : ''

      output.push(shouldIncludePrefix ? `${this.prefix} ${binding}${pattern}` : pattern)
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
      // Raw (expression) and parameterised items render as separate SET
      // clauses, run-length grouped so same-form items stay together: the
      // embedded Relate engine drops the trailing items of a SET clause
      // that mixes the two forms (NTS-569). Multiple plain SET clauses are
      // valid Cypher and apply in order — ON CREATE/ON MATCH SET keep their
      // single-clause shape (two of those are invalid Cypher, NTS-491).
      const runs: { isRaw: boolean; items: SetClause[] }[] = []

      for (const item of this.valuesToSet) {
        const isRaw = typeof item === 'string' || item.isRaw
        const last = runs.at(-1)

        if (last?.isRaw === isRaw) {
          last.items.push(item)
        } else {
          runs.push({ isRaw, items: [item] })
        }
      }

      for (const { items } of runs) {
        output.push(`SET ${items.map((value) => value.toString()).join(', ')}`)
      }
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
      output.push(`RETURN ${this.distinctReturn ? 'DISTINCT ' : ''}${this.returnValues.join(', ')}`)
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
