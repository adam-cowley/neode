import { Match } from './match.js'
import { NeodeError } from '../errors/index.js'
import { Order } from './order.js'
import { Property } from './property.js'
import { Relationship } from './relationship.js'
import { Statement } from './statement.js'
import { Where, OPERATOR_EQUALS } from './where.js'
import { LabelPredicate } from './label-predicate.js'
import { WhereBetween } from './where-between.js'
import { WhereId } from './where-id.js'
import { WhereNull } from './where-null.js'
import { WhereRaw } from './where-raw.js'
import { WhereStatement } from './where-statement.js'
import { WithDistinctStatement } from './with-distinct-statement.js'
import { WithStatement } from './with-statement.js'
import type { AccessMode, QueryOutput, Runner } from '../driver/types.js'
import type { EntitySchema } from '../meta/entity/entity-schema.js'
import { isRecord } from '../services/type-guards.js'
import {
  ConstraintAction,
  ConstraintType,
  propertyTypeStatement,
  schemaStatement,
} from '../services/schema/schema.service.js'

/**
Identity criteria for a persisted entity, as produced by
matchCriteriaForEntity: the elementId when known, else the primary key
property to match on
*/
export interface EntityMatchCriteria {
  elementId?: string
  key: string
  value?: unknown
}

export type BuilderParameters = Record<string, unknown>

/**
Fluent Cypher query builder.

A statement-based builder: every `match()` / `create()` / `merge()` call
starts a new statement segment; where clauses accumulate against the
current segment and are flushed into it when the next segment starts or
when `build()` is called.

All user values are passed as query parameters - the generated query
contains only aliases.
*/
export class Builder {
  private readonly params: BuilderParameters = {}
  private readonly statements: { toString(shouldIncludePrefix?: boolean): string }[] = []

  private current?: Statement
  private whereClause?: WhereStatement
  private parameterCount = 0
  private subCount = 0

  /**
  Whether the last opened segment ended in an updating clause
  (CREATE / MERGE) or a DELETE clause. Neo4j rejects a reading clause
  directly after either — "WITH is required between CREATE and MATCH",
  "WITH is required between DELETE and MATCH" (42N24) — so
  match() / optionalMatch() bridge the transition with `WITH *`, which
  preserves every in-scope variable.
  */
  private afterWriteClause = false
  private afterDeleteClause = false

  /**
  The statement segment currently being built — every pattern method
  appends to it.
  */
  private get activeStatement(): Statement {
    if (this.current === undefined) {
      throw new NeodeError(
        'Builder has no open statement — call match(), create(), merge() or statement() first',
      )
    }

    return this.current
  }

  /**
  The where segment currently being built — every where method appends
  to it.
  */
  private get activeWhereClause(): WhereStatement {
    if (this.whereClause === undefined) {
      throw new NeodeError(
        'Builder has no open where segment — call match(), create(), merge() or whereStatement() first',
      )
    }

    return this.whereClause
  }

  /**
  Generate a unique parameter name and add the value to the params object
  */
  private addParameter(key: string, value: unknown): string {
    let attempt = 1
    const base = `where_${key.replaceAll(/[^a-z0-9]+/gi, '_')}`

    let variable = base

    while (this.params[variable] !== undefined) {
      attempt++
      variable = `${base}_${String(attempt)}`
    }

    this.params[variable] = value

    return variable
  }

  /**
  Convert a map of properties into inline pattern properties,
  adding each value to the query parameters
  */
  private convertPropertyMap(
    alias: string | undefined,
    properties?: BuilderParameters,
  ): Property[] {
    if (properties === undefined) {
      return []
    }

    return Object.entries(properties).map(([key, value]) => {
      const propertyAlias = `${String(alias)}_${key}`

      this.params[propertyAlias] = value

      return new Property(key, propertyAlias)
    })
  }

  private whereStringOperator(property: string, value: string, operator: string): this {
    const variable = this.addParameter(property, value)

    this.activeWhereClause.append(new Where(property, operator, `$${variable}`))

    return this
  }

  /**
  Flush any open statement / where segment into `statements`.

  The next where segment is opened with a WHERE prefix: where* methods
  chained after the raw segments pushed by callProcedure / call /
  unwind / forEach / DDL land on the statement following that segment
  and need the keyword (NTS-475) — segment-starting methods like
  match() pass it themselves, flush() covers the remaining positions.
  */
  private flush(): void {
    this.whereStatement('WHERE')
    this.statement()
  }

  /**
  Compile a sub-builder into a query fragment, namespacing its parameters
  into this builder's parameter space (sub0_, sub1_, …) so nested queries
  never collide with parent or sibling parameters
  */
  private compileSub(
    build: (sub: Builder) => Builder,
    imports: string[] = [],
  ): { inner: string; imports: string[] } {
    const sub = new Builder()
    const returned = build(sub)

    const { query, params } = returned.build()
    const prefix = `sub${String(this.subCount++)}_`

    for (const [key, value] of Object.entries(params)) {
      this.params[`${prefix}${key}`] = value
    }

    return {
      inner: query.replaceAll(/\$(\w+)/g, (_match, key: string) => `$${prefix}${key}`),
      imports,
    }
  }

  private schemaStatementSegment(
    action: ConstraintAction,
    type: ConstraintType,
    label: string,
    properties: string[],
    cypherType = '',
  ): this {
    this.flush()
    // Builder DDL composes the label unquoted (`FOR (n:User)`) — the
    // SchemaService spellings stay quoted via the shared composers' default
    this.statements.push({
      toString: () =>
        type === ConstraintType.PROPERTY_TYPE
          ? propertyTypeStatement(action, label, properties[0] ?? '', cypherType, undefined, false)
          : schemaStatement(action, type, label, properties, undefined, false),
    })

    return this
  }

  /**
  Bridge an updating / DELETE -> reading clause transition: Neo4j rejects a
  MATCH directly after CREATE / MERGE / DELETE without an intervening WITH,
  so emit `WITH *` — it preserves every in-scope variable
  */
  private bridgeWriteToRead(): void {
    if (!this.afterWriteClause && !this.afterDeleteClause) {
      return
    }

    this.statements.push(new WithStatement(['*']))
    this.afterWriteClause = false
    this.afterDeleteClause = false
  }

  /**
  Register a named parameter for use in raw expressions (`$name`) — the
  channel for values inside setExpr / callProcedure / whereRaw positions,
  where the builder cannot bind values itself (NTS-462/473)
  */
  param(name: string, value: unknown): this {
    this.params[name] = value

    return this
  }

  /**
  Start a new query segment and set the current statement
  */
  statement(prefix?: string): this {
    if (this.current) {
      this.statements.push(this.current)
    }

    this.current = new Statement(prefix)

    return this
  }

  /**
  Start a new where segment. When a where segment is already open, it is
  flushed into the current statement first.
  */
  whereStatement(prefix?: string): this {
    if (this.whereClause && this.current) {
      this.current.where(this.whereClause.toString())
    }

    this.whereClause = new WhereStatement(prefix)

    return this
  }

  /**
  Match a node pattern by alias and optional labels / inline properties
  */
  match(alias?: string, labels?: string | string[] | false, properties?: BuilderParameters): this {
    this.whereStatement('WHERE')
    this.statement()
    this.bridgeWriteToRead()

    this.activeStatement.match(new Match(alias, labels, this.convertPropertyMap(alias, properties)))

    return this
  }

  /**
  Add an optional match to the query
  */
  optionalMatch(alias?: string, labels?: string | string[] | false): this {
    this.whereStatement('WHERE')
    this.statement('OPTIONAL MATCH')
    this.bridgeWriteToRead()

    this.activeStatement.match(new Match(alias, labels))

    return this
  }

  /**
  Add a `WITH` clause to the query
  */
  with(...variables: string[]): this {
    this.whereStatement('WHERE')
    this.statement()

    // The user's own WITH satisfies the updating / DELETE -> reading
    // requirement
    this.afterWriteClause = false
    this.afterDeleteClause = false
    this.statements.push(new WithStatement(variables))

    return this
  }

  /**
  Add a `WITH DISTINCT` clause to the query
  */
  withDistinct(...variables: string[]): this {
    this.whereStatement('WHERE')
    this.statement()

    this.afterWriteClause = false
    this.afterDeleteClause = false
    this.statements.push(new WithDistinctStatement(variables))

    return this
  }

  /**
  Start an `OR` where clause. Switches the connector used for the next
  condition appended to the current where segment (creating one if none
  is open) so that it combines with `OR` instead of `AND`.
  
  P2.2 parity (neode Builder#or): neode opens a separate `OR (...)`
  segment, which renders an invalid leading `OR (` when called before
  any where condition. Here the connector applies to the next clause
  inside the single WHERE group instead; Cypher's operator precedence
  keeps the semantics identical to neode's grouped output.
  */
  or(...arguments_: unknown[]): this {
    if (this.whereClause === undefined) {
      this.whereStatement('WHERE')
    }

    this.activeWhereClause.setConnector('OR')

    return this.where(...arguments_)
  }

  /**
  A parenthesised group of where conditions, built by the callback:
  
  - `whereGroup(g => g.where('n.age', '>', 30).where('n.age', '<', 40))`
    renders `(n.age > $x AND n.age < $y)`, joined to the surrounding
    conditions by the enclosing connector — so
    `where('n.name', 'Adam').or().whereGroup(…)` gives
    `(n.name = $z OR (n.age > $x AND n.age < $y))`, the shape flat
    connectors cannot express (AND binds tighter than OR).
  
  The callback receives this builder; call only where methods on it.
  Groups nest. An empty group adds no condition.
  */
  whereGroup(build: (group: Builder) => Builder): this {
    const parent = this.activeWhereClause
    const group = new WhereStatement()

    this.whereClause = group

    try {
      build(this)
    } finally {
      this.whereClause = parent
    }

    if (group.toString() !== '') {
      parent.append(group)
    }

    return this
  }

  /**
  Add a where condition to the current statement. Supported forms:
  
  - `where('n.name', 'Adam')` - equality
  - `where('n.age', '>', 30)` - explicit operator
  - `where({ name: 'Adam' })` - object map
  - `where([['name', 'Adam'], ['age', '>', 30]])` - array of clauses
  - `where('n.name =~ ".*"')` - raw string
  */
  where(...arguments_: unknown[]): this {
    const first = arguments_[0]

    // neode parity: a falsy first argument (undefined, null, '', 0, false, NaN, 0n)
    // adds no condition at all — an empty argument list is covered by the
    // undefined check
    if (
      first === undefined ||
      first === null ||
      first === '' ||
      first === false ||
      first === 0 ||
      first === 0n ||
      (typeof first === 'number' && Number.isNaN(first))
    ) {
      return this
    }

    // Single argument: object, array or raw string
    if (arguments_.length === 1) {
      if (Array.isArray(first)) {
        for (const inner of first) {
          if (!Array.isArray(inner)) {
            continue
          }

          const clauseArguments: unknown[] = inner

          this.where(...clauseArguments)
        }
      } else if (isRecord(first)) {
        for (const [key, value] of Object.entries(first)) {
          this.where(key, value)
        }
      } else if (typeof first === 'string') {
        this.whereRaw(first)
      } else if (
        typeof first === 'number' ||
        typeof first === 'bigint' ||
        typeof first === 'boolean'
      ) {
        this.whereRaw(String(first))
      }
    } else {
      if (typeof first !== 'string') {
        throw new TypeError(
          `where() expects a string property as its first argument, received ${typeof first}`,
        )
      }

      if (arguments_.length === 2) {
        // Two arguments: property / value equality
        const variable = this.addParameter(first, arguments_[1])

        this.activeWhereClause.append(new Where(first, OPERATOR_EQUALS, `$${variable}`))
      } else {
        const operator = arguments_[1]

        if (typeof operator !== 'string') {
          throw new TypeError('where() expects a string operator as its second argument')
        }

        const variable = this.addParameter(first, arguments_[2])

        this.activeWhereClause.append(new Where(first, operator, `$${variable}`))
      }
    }

    return this
  }

  /**
  Query on element ID
  */
  whereId(alias: string, value: string | number): this {
    const variable = this.addParameter(`${alias}_id`, value)

    this.activeWhereClause.append(new WhereId(alias, variable))

    return this
  }

  /**
  Add a raw where clause
  */
  whereRaw(clause: string): this {
    this.activeWhereClause.append(new WhereRaw(clause))

    return this
  }

  /**
  Negate the previous where condition
  */
  whereNot(...arguments_: unknown[]): this {
    this.where(...arguments_)

    const last = this.activeWhereClause.last()

    if (last instanceof Where) {
      last.setNegative()
    }

    return this
  }

  /**
  Between clause: `$floor <= alias <= $ceiling`
  */
  whereBetween(alias: string, floor: unknown, ceiling: unknown): this {
    const floorVariable = this.addParameter(`${alias}_floor`, floor)
    const ceilingVariable = this.addParameter(`${alias}_ceiling`, ceiling)

    this.activeWhereClause.append(new WhereBetween(alias, floorVariable, ceilingVariable))

    return this
  }

  /**
  Negative between clause
  */
  whereNotBetween(alias: string, floor: unknown, ceiling: unknown): this {
    this.whereBetween(alias, floor, ceiling)

    const last = this.activeWhereClause.last()

    if (last instanceof WhereBetween) {
      last.setNegative()
    }

    return this
  }

  /**
  Membership test: `alias IN $param` over the given values
  */
  whereIn(property: string, values: unknown[]): this {
    const variable = this.addParameter(property, values)

    this.activeWhereClause.append(new Where(property, 'IN', `$${variable}`))

    return this
  }

  /**
  Substring test: `property CONTAINS $param`
  */
  whereContains(property: string, value: string): this {
    return this.whereStringOperator(property, value, 'CONTAINS')
  }

  /**
  Prefix test: `property STARTS WITH $param`
  */
  whereStartsWith(property: string, value: string): this {
    return this.whereStringOperator(property, value, 'STARTS WITH')
  }

  /**
  Suffix test: `property ENDS WITH $param`
  */
  whereEndsWith(property: string, value: string): this {
    return this.whereStringOperator(property, value, 'ENDS WITH')
  }

  /**
  `property IS NULL`
  */
  whereNull(property: string): this {
    this.activeWhereClause.append(new WhereNull(property))

    return this
  }

  /**
  `property IS NOT NULL`
  */
  whereNotNull(property: string): this {
    this.whereNull(property)

    const last = this.activeWhereClause.last()

    if (last instanceof WhereNull) {
      last.setNegative()
    }

    return this
  }

  /**
  Existential subquery: `EXISTS { pattern }`. The fragment is taken
  verbatim - pass a node/relationship pattern or an inner
  `MATCH ... RETURN ...` subquery; values inside cannot be parameterised.
  */
  whereExists(pattern: string): this {
    return this.whereRaw(`EXISTS { ${pattern} }`)
  }

  /**
  `ANY(variable IN list WHERE predicate)` over a list expression
  (a property holding a list, or a literal list). The predicate is
  taken verbatim - inline literals or use whereRaw for parameters.
  */
  whereAny(variable: string, list: string, predicate: string): this {
    return this.whereRaw(`ANY(${variable} IN ${list} WHERE ${predicate})`)
  }

  /**
  Label predicate: `alias:Label` (or `NOT alias:Label`), optionally
  over several labels - all of them must be present
  */
  whereLabel(alias: string, label: string | string[], isNegated = false): this {
    this.activeWhereClause.append(new LabelPredicate(alias, label, isNegated))

    return this
  }

  /**
  Order by a label predicate: `ORDER BY alias:Label [direction]`
  (shares the label-predicate machinery with whereLabel)
  */
  orderByLabel(alias: string, label: string | string[], direction = ''): this {
    this.activeStatement.order(new Order(new LabelPredicate(alias, label).toString(), direction))

    return this
  }

  /**
  Add a `DELETE` clause
  */
  delete(...values: string[]): this {
    this.activeStatement.delete(...values)

    // Updating clauses may follow each other directly, but a reading
    // clause after a DELETE needs the WITH bridge (42N24)
    this.afterDeleteClause = true
    this.afterWriteClause = false

    return this
  }

  /**
  Add a `DETACH DELETE` clause
  */
  detachDelete(...values: string[]): this {
    this.activeStatement.detachDelete(...values)

    this.afterDeleteClause = true
    this.afterWriteClause = false

    return this
  }

  /**
  Start a `CREATE` statement
  */
  create(alias: string, labels?: string | string[] | false, properties?: BuilderParameters): this {
    this.whereStatement('WHERE')
    this.statement('CREATE')
    this.afterWriteClause = true
    this.afterDeleteClause = false

    this.activeStatement.match(new Match(alias, labels, this.convertPropertyMap(alias, properties)))

    return this
  }

  /**
  Start a `MERGE` statement
  */
  merge(alias: string, labels?: string | string[] | false, properties?: BuilderParameters): this {
    this.whereStatement('WHERE')
    this.statement('MERGE')
    this.afterWriteClause = true
    this.afterDeleteClause = false

    this.activeStatement.match(new Match(alias, labels, this.convertPropertyMap(alias, properties)))

    return this
  }

  /**
  Set a property. Supported forms:
  
  - `set('n.name', 'Adam')` - parameterised set
  - `set('n.age', 30, '+=')` - explicit operator
  - `set({ 'n.name': 'Adam' })` - map of properties
  - `set('n.age = n.age + 1', undefined)` - raw set
  */
  set(property: string | Record<string, unknown>, value?: unknown, operator = '='): this {
    if (value === undefined && isRecord(property)) {
      for (const [key, value_] of Object.entries(property)) {
        this.set(key, value_)
      }
    } else {
      if (typeof property !== 'string') {
        throw new TypeError('set() expects a string property when a value is given')
      }

      if (value === undefined) {
        this.activeStatement.setRaw([property])
      } else {
        const alias = `set_${String(this.parameterCount)}`
        this.params[alias] = value
        this.parameterCount++

        this.activeStatement.set(property, alias, operator)
      }
    }

    return this
  }

  /**
  Set a property only on `ON CREATE SET`
  */
  onCreateSet(property: string | Record<string, unknown>, value?: unknown, operator = '='): this {
    if (value === undefined && isRecord(property)) {
      for (const [key, value_] of Object.entries(property)) {
        this.onCreateSet(key, value_)
      }
    } else {
      if (typeof property !== 'string') {
        throw new TypeError('onCreateSet() expects a string property when a value is given')
      }

      const alias = `set_${String(this.parameterCount)}`
      this.params[alias] = value
      this.parameterCount++

      this.activeStatement.onCreateSet(property, alias, operator)
    }

    return this
  }

  /**
  Set a property only on `ON MATCH SET`
  */
  onMatchSet(property: string | Record<string, unknown>, value?: unknown, operator = '='): this {
    if (value === undefined && isRecord(property)) {
      for (const [key, value_] of Object.entries(property)) {
        this.onMatchSet(key, value_)
      }
    } else {
      if (typeof property !== 'string') {
        throw new TypeError('onMatchSet() expects a string property when a value is given')
      }

      const alias = `set_${String(this.parameterCount)}`
      this.params[alias] = value
      this.parameterCount++

      this.activeStatement.onMatchSet(property, alias, operator)
    }

    return this
  }

  /**
  Persist a vector property through Neo4j's space-efficient vector
  storage procedure (NTS-449): `CALL db.create.setNodeVectorProperty(...)`
  for nodes, `db.create.setRelationshipVectorProperty` for
  relationships. Rendered as its own CALL clause after the statement's
  SET clauses.
  */
  setVectorProperty(
    alias: string,
    property: string,
    value: unknown,
    target: 'node' | 'relationship' = 'node',
  ): this {
    const parameterAlias = `set_${String(this.parameterCount)}`
    this.params[parameterAlias] = value
    this.parameterCount++

    const procedure =
      target === 'relationship'
        ? 'db.create.setRelationshipVectorProperty'
        : 'db.create.setNodeVectorProperty'

    this.activeStatement.call(
      `CALL ${procedure}(${alias}, ${JSON.stringify(property)}, $${parameterAlias})`,
    )

    return this
  }

  /**
  Remove properties or labels, in `n.prop` or `n:Label` format
  */
  remove(...items: string[]): this {
    this.activeStatement.remove(items)

    return this
  }

  /**
  Set return fields / expressions
  */
  return(...values: string[]): this {
    this.activeStatement.return(...values)

    return this
  }

  /**
  Set the record limit
  */
  limit(limit: number): this {
    this.activeStatement.limit(limit)

    return this
  }

  /**
  Set records to skip
  */
  skip(skip: number): this {
    this.activeStatement.skip(skip)

    return this
  }

  /**
  Add an order by clause. Supported forms:
  
  - `orderBy('n.name', 'DESC')`
  - `orderBy('n.name')`
  - `orderBy(['n.name', 'n.other'])`
  - `orderBy({ 'n.name': 'DESC' })`
  - `orderBy({ field: 'n.name', order: 'DESC' })`
  - `orderBy([{ field: 'n.name', order: 'ASC' }, { field: 'n.other', order: 'DESC' }])`
  */
  orderBy(...arguments_: unknown[]): this {
    let order: Order | undefined
    const first = arguments_[0]

    if (arguments_.length === 2) {
      order = new Order(String(first), String(arguments_[1]))
    } else if (Array.isArray(first)) {
      for (const argument of first) {
        this.orderBy(argument)
      }
    } else if (isRecord(first)) {
      const field = first['field']

      if (typeof field === 'string' && field !== '') {
        // P2.2 parity (neode Builder#orderBy): an object carrying a
        // `field` key is a single `{ field, order }` descriptor,
        // not a field -> direction map.
        const direction = first['order']

        order = new Order(field, typeof direction === 'string' ? direction : '')
      } else {
        for (const [key, value] of Object.entries(first)) {
          this.orderBy(key, value)
        }
      }
    } else if (typeof first === 'string' && first !== '') {
      order = new Order(first)
    }

    if (order) {
      this.activeStatement.order(order)
    }

    return this
  }

  /**
  Add a relationship pattern to the current statement
  
  @param type  Relationship type, or array of types
  @param direction  Direction of the relationship
  @param alias  Relationship alias
  @param degrees  Number of traversals (1, "1..2", "0..2", "..3")
  */
  relationship(
    type?: string | string[],
    direction?: string,
    alias?: string,
    degrees?: number | string,
  ): this {
    this.activeStatement.match(new Relationship(type, direction, alias, degrees))

    return this
  }

  /**
  `SET <key> = <expression>` where the expression is raw Cypher
  (`datetime()`, `coalesce($email, u.email)`, …). Values inside the
  expression are bound via `param(name, value)` — the expression must
  never interpolate data.
  */
  setExpr(key: string, expression: string, parameters: BuilderParameters = {}): this {
    this.activeStatement.setRaw([`${key} = ${expression}`])

    for (const [name, value] of Object.entries(parameters)) {
      this.param(name, value)
    }

    return this
  }

  /**
  `ON CREATE SET <key> = <expression>` — expression-valued, so server-side
  values (`datetime()`, `randomUUID()`) and param-first coalesces compose
  without raw Cypher (NTS-460/462)
  */
  onCreateSetExpr(key: string, expression: string, parameters: BuilderParameters = {}): this {
    this.activeStatement.onCreateSetRaw([`${key} = ${expression}`])

    for (const [name, value] of Object.entries(parameters)) {
      this.param(name, value)
    }

    return this
  }

  /**
  `ON MATCH SET <key> = <expression>` — expression-valued (NTS-460/462)
  */
  onMatchSetExpr(key: string, expression: string, parameters: BuilderParameters = {}): this {
    this.activeStatement.onMatchSetRaw([`${key} = ${expression}`])

    for (const [name, value] of Object.entries(parameters)) {
      this.param(name, value)
    }

    return this
  }

  /**
  A procedure call with YIELD: `CALL db.index.fulltext.queryNodes($index, $q)
  YIELD node, score`. Arguments are expressions — bind values via
  `param(name, value)` and pass `'$name'` (NTS-464).
  */
  callProcedure(procedure: string, arguments_: string[] = [], yields: string[] = []): this {
    this.flush()

    const argumentList = arguments_.join(', ')
    const call = `CALL ${procedure}(${argumentList})`
    const yieldClause = yields.length > 0 ? ` YIELD ${yields.join(', ')}` : ''

    this.statements.push({ toString: () => `${call}${yieldClause}` })

    return this
  }

  /**
  Constraint / index DDL, composed like queries (NTS-474). Each call
  appends one idempotent schema statement.
  */
  createUniqueConstraint(label: string, property: string): this {
    return this.schemaStatementSegment(ConstraintAction.CREATE, ConstraintType.UNIQUE, label, [
      property,
    ])
  }

  createRangeIndex(label: string, property: string): this {
    return this.schemaStatementSegment(ConstraintAction.CREATE, ConstraintType.INDEX, label, [
      property,
    ])
  }

  createCompositeUniqueConstraint(label: string, properties: string[]): this {
    return this.schemaStatementSegment(
      ConstraintAction.CREATE,
      ConstraintType.UNIQUE,
      label,
      properties,
    )
  }

  createCompositeIndex(label: string, properties: string[]): this {
    return this.schemaStatementSegment(
      ConstraintAction.CREATE,
      ConstraintType.INDEX,
      label,
      properties,
    )
  }

  createExistenceConstraint(label: string, property: string): this {
    return this.schemaStatementSegment(ConstraintAction.CREATE, ConstraintType.EXISTS, label, [
      property,
    ])
  }

  createPropertyTypeConstraint(label: string, property: string, cypherType: string): this {
    return this.schemaStatementSegment(
      ConstraintAction.CREATE,
      ConstraintType.PROPERTY_TYPE,
      label,
      [property],
      cypherType,
    )
  }

  dropConstraint(
    label: string,
    property: string,
    type: ConstraintType = ConstraintType.UNIQUE,
  ): this {
    return this.schemaStatementSegment(ConstraintAction.DROP, type, label, [property])
  }

  /**
  A scoped subquery: `CALL (u) { … }`. The callback builds the inner
  query; `imports` names outer-scope variables passed into the subquery.
  */
  call(build: (sub: Builder) => Builder, imports: string[] = []): this {
    const { inner } = this.compileSub(build, imports)
    const scope = imports.length > 0 ? `(${imports.join(', ')})` : ''

    this.flush()
    this.statements.push({ toString: () => `CALL ${scope} {\n${inner}\n}` })

    return this
  }

  /**
  `UNWIND <listExpression> AS <variable>`
  */
  unwind(listExpression: string, variable: string): this {
    this.flush()
    this.statements.push({ toString: () => `UNWIND ${listExpression} AS ${variable}` })

    return this
  }

  /**
  `FOREACH (<variable> IN <listExpression> | <clauses>)` — the callback
  builds the update clauses (SET / MERGE / DELETE …) applied per element
  */
  forEach(variable: string, listExpression: string, build: (sub: Builder) => Builder): this {
    const { inner } = this.compileSub(build)
    const clauses = inner.replaceAll('\n', ' ')

    this.flush()
    this.statements.push({
      toString: () => `FOREACH (${variable} IN ${listExpression} | ${clauses})`,
    })

    return this
  }

  /**
  `COUNT { … } AS <alias>` in a RETURN / WITH position (NTS: grouped and
  conditional counts without hand-written Cypher)
  */
  countSubquery(alias: string, build: (sub: Builder) => Builder, imports: string[] = []): this {
    const { inner, imports: scoped } = this.compileSub(build, imports)
    const scope = scoped.length > 0 ? `WITH ${scoped.join(', ')} ` : ''

    this.return(`COUNT { ${scope}${inner} } AS ${alias}`)

    return this
  }

  /**
  `COLLECT { … } AS <alias>` in a RETURN / WITH position (NTS: collected
  sub-projections without hand-written Cypher)
  */
  collectSubquery(alias: string, build: (sub: Builder) => Builder, imports: string[] = []): this {
    const { inner, imports: scoped } = this.compileSub(build, imports)
    const scope = scoped.length > 0 ? `WITH ${scoped.join(', ')} ` : ''

    this.return(`COLLECT { ${scope}${inner} } AS ${alias}`)

    return this
  }

  /**
  `EXISTS { … }` as a WHERE predicate (NTS: relationship / property
  existence checks without hand-written Cypher)
  */
  whereExistsSubquery(build: (sub: Builder) => Builder, imports: string[] = []): this {
    const { inner, imports: scoped } = this.compileSub(build, imports)
    const scope = scoped.length > 0 ? `WITH ${scoped.join(', ')} ` : ''

    this.whereRaw(`EXISTS { ${scope}${inner} }`)

    return this
  }

  /**
  Complete a relationship with a target node pattern
  */
  to(alias: string, labels?: string | string[] | false, properties?: BuilderParameters): this {
    this.activeStatement.match(new Match(alias, labels, this.convertPropertyMap(alias, properties)))

    return this
  }

  /**
  Match a node by an entity's identity (as produced by
  matchCriteriaForEntity): elementId when known, else the primary key
  property. One implementation keeps read and write paths in lockstep.
  */
  matchEntity(alias: string, schema: EntitySchema, criteria: EntityMatchCriteria): this {
    return criteria.elementId === undefined || criteria.elementId === ''
      ? this.match(alias, schema.getLabels(), { [criteria.key]: criteria.value })
      : this.match(alias).whereId(alias, criteria.elementId)
  }

  /**
  Complete a relationship with a target node matched by an entity's
  identity (the `to(...)` counterpart of matchEntity)
  */
  toEntity(alias: string, schema: EntitySchema, criteria: EntityMatchCriteria): this {
    return criteria.elementId === undefined || criteria.elementId === ''
      ? this.to(alias, schema.getLabels(), { [criteria.key]: criteria.value })
      : this.to(alias).whereId(alias, criteria.elementId)
  }

  /**
  Complete a relationship pointing to anything
  */
  toAnything(): this {
    this.activeStatement.match(new Match())

    return this
  }

  /**
  Build the pattern without any keywords
  */
  pattern(): string {
    this.whereStatement()
    this.statement()

    return this.statements
      .map((statement) => statement.toString(false))
      .filter((statement) => statement.length > 0)
      .join('\n')
  }

  /**
  Build and run the query against the given runner (neode's
  Builder#execute): pass `neode.getConnection()` to run it through the
  connection provider, which honours the READ / WRITE mode
  */
  async execute(runner: Runner, mode: AccessMode = 'WRITE'): Promise<QueryOutput> {
    const { query, params } = this.build()

    // A ConnectionProvider routes by mode; a bare Runner ignores the
    // extra argument
    return runner.run(query, params, mode)
  }

  /**
  Build the query
  */
  build(): { query: string; params: BuilderParameters } {
    this.whereStatement()
    this.statement()

    const query = this.statements
      .map((statement) => statement.toString())
      .filter((statement) => statement.length > 0)
      .join('\n')

    return {
      query,
      params: this.params,
    }
  }
}
