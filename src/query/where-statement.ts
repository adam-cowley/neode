export const CONNECTOR_AND = 'AND'

interface WhereClause {
  toString(): string
}

export class WhereStatement {
  private readonly clauses: WhereClause[] = []

  /**
  Connector joining each clause to the one before it.
  
  P2.2 parity (neode WhereStatement): connectors are tracked per clause
  rather than for the whole group, so that `where(a).where(b).or(c)`
  renders `a AND b OR c` - equivalent to neode's grouped
  `WHERE (a AND b) OR (c)` under Cypher's operator precedence
  (AND binds tighter than OR) - instead of promoting every join
  in the group to OR.
  */
  private readonly connectors: string[] = []
  private nextConnector: string = CONNECTOR_AND
  private readonly prefix: string = ''

  constructor(prefix = '') {
    this.prefix = prefix
  }

  /**
  Set the connector used for the next clause appended to this
  statement (AND, OR). Resets to AND once a clause is appended.
  */
  setConnector(connector: string): void {
    this.nextConnector = connector
  }

  append(clause: WhereClause): this {
    if (this.clauses.length > 0) {
      this.connectors.push(this.nextConnector)
      this.nextConnector = CONNECTOR_AND
    }

    this.clauses.push(clause)

    return this
  }

  last(): WhereClause | undefined {
    return this.clauses.at(-1)
  }

  toString(): string {
    if (this.clauses.length === 0) {
      return ''
    }

    const statements = this.clauses.map((clause) => clause.toString())

    const joined = statements
      .map((statement, index) =>
        index === 0 ? statement : ` ${this.connectors[index - 1] ?? CONNECTOR_AND} ${statement}`,
      )
      .join('')

    const prefix = this.prefix === '' ? '' : `${this.prefix} `

    return `${prefix}(${joined})`
  }
}
