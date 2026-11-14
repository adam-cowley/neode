import { Match } from './match.js'
import { NeodeError } from '../errors/index.js'
import { Order } from './order.js'
import { PathPattern } from './path.js'
import { Property } from './property.js'
import { RawExpression } from './expressions.js'
import { Relationship } from './relationship.js'
import { Statement } from './statement.js'
import { Where, OPERATOR_EQUALS, assertComparisonOperator } from './where.js'
import type { ComparisonOperator } from './where.js'
import {
  quote,
  quoteReference,
  assertAlias,
  assertDegrees,
  assertSetOperator,
  assertWhereOperator,
} from './quote.js'
import { LabelPredicate } from './label-predicate.js'
import { WhereBetween } from './where-between.js'
import { WhereId } from './where-id.js'
import { WhereNull } from './where-null.js'
import { WhereRaw } from './where-raw.js'
import { WhereStatement } from './where-statement.js'
import { WithDistinctStatement } from './with-distinct-statement.js'
import { WithStatement } from './with-statement.js'
import { THIS_NODE } from '../constants.js'
import type { AccessMode, QueryOutput, Runner } from '../driver/types.js'
import { getModel } from '../meta/index.js'
import type { EntitySchema } from '../meta/entity/entity-schema.js'
import type { Newable } from '../meta/newable.js'
import { applyReadFilters, type ReadFilterOptions } from '../services/query/filters.js'
import { isRecord } from '../services/type-guards.js'
import {
  ConstraintAction,
  ConstraintType,
  propertyTypeStatement,
  schemaStatement,
} from '../services/schema/schema.service.js'
import {
  createFulltextStatement,
  dropFulltextStatement,
  fulltextIndexName,
} from '../services/schema/fulltext.service.js'

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
Options for Builder.shortestPath() (NTS-658)
*/
export interface ShortestPathOptions {
  /**
  Relationship type (or types) the path may traverse
  */
  relationship?: string | string[]
  /**
  Direction of the relationship pattern — defaults to BOTH (undirected)
  */
  direction?: string
  /**
  Number of traversals — Neo4j rejects a minimum length other than 0 or
  1 inside shortestPath, so multi-hop bounds are `'..2'` / `'1..2'` forms
  (an exact length like `2` throws naming the fix; pin an exact edge
  chain with match()/relationship()/to()/asPath() instead)
  */
  degrees?: number | string
}

/**
Scan compiled query text for `$name` parameter references (NTS-478).

String literals and backtick-quoted identifiers are blanked out first —
each blanked with same-length spaces so the reported indices stay valid
against the original text — so `$`-shaped text inside them never
false-positives. Backslash escapes inside literals are honoured; backtick
identifiers have no escapes (Cypher doubles the backtick instead, which
the regex also blanks).

shortcut: comments are not blanked — the builder never emits comments, but
a `$word` inside a hand-written `//` comment would report as unbound; and
quote pairing is single-pass, so a stray apostrophe can span a later
literal — a real `$param` it swallows reports as unbound at build time,
never silently corrupts.
*/
function parameterReferences(query: string): { name: string; index: number }[] {
  const blanked = query
    .replaceAll(/'(?:\\.|[^'\\])*'/g, (match) => ' '.repeat(match.length))
    .replaceAll(/"(?:\\.|[^"\\])*"/g, (match) => ' '.repeat(match.length))
    .replaceAll(/`(?:\\.|[^`\\])*`/g, (match) => ' '.repeat(match.length))

  const references = Array.from(blanked.matchAll(/\$(\w+)/g), (match) => ({
    // the regex's capture group is always present when the match succeeds
    name: match[1] ?? '',
    index: match.index,
  }))

  return references
}

/**
Fluent Cypher query builder.

A statement-based builder: every `match()` / `create()` / `merge()` call
starts a new statement segment; where clauses accumulate against the
current segment and are flushed into it when the next segment starts or
when `build()` is called.

All user values are passed as query parameters - the generated query
contains only aliases. The one exception is `RawExpression` property
values (NTS-460), which render verbatim into patterns; bind the values
they reference via `param(name, value)`. Named read filters compose into
the chain with `withFilters(model, alias?, options?)` (NTS-614).
*/
export class Builder {
  private readonly params: BuilderParameters = {}
  private readonly statements: { toString(shouldIncludePrefix?: boolean): string }[] = []

  private current?: Statement
  private whereClause?: WhereStatement
  private parameterCount = 0
  private subCount = 0

  /**
  Set by return() / returnDistinct(), reset by union() — union() fails fast
  when the preceding branch ended without a RETURN
  */
  private hasReturned = false

  /**
  Set by union() until the next branch's RETURN: a query that ends without
  the final branch's RETURN is invalid Cypher (every UNION branch must end
  in RETURN), caught in build() instead of reaching the database
  */
  private afterUnion = false

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
  Generate a unique parameter name for `value` under `base`, sanitised to
  identifier characters (NTS-609). Uniqueness is checked against used
  names with `Object.hasOwn` — never against values, so a slot holding
  `undefined` still counts as taken and a later binding cannot silently
  reuse it.
  */
  private addParameterNamed(base: string, value: unknown): string {
    let attempt = 1
    const sanitised = base.replaceAll(/[^a-z0-9]+/gi, '_')

    let variable = sanitised

    while (Object.hasOwn(this.params, variable)) {
      attempt++
      variable = `${sanitised}_${String(attempt)}`
    }

    this.params[variable] = value

    return variable
  }

  /**
  Generate a unique parameter name and add the value to the params object
  */
  private addParameter(key: string, value: unknown): string {
    return this.addParameterNamed(`where_${key}`, value)
  }

  /**
  Parse the orderBy argument forms and hand every parsed Order to the
  sink (the statement's ORDER BY or the WITH's, NTS-477). Supported
  forms:

  - `('n.name', 'DESC')`
  - `('n.name')`
  - `(['n.name', 'n.other'])`
  - `({ 'n.name': 'DESC' })`
  - `({ field: 'n.name', order: 'DESC' })`
  - `([{ field: 'n.name', order: 'ASC' }, { field: 'n.other', order: 'DESC' }])`
  */
  private addOrder(target: (order: Order) => void, ...arguments_: unknown[]): void {
    let order: Order | undefined
    const first = arguments_[0]

    if (arguments_.length === 2) {
      order = new Order(String(first), String(arguments_[1]))
    } else if (Array.isArray(first)) {
      for (const argument of first) {
        this.addOrder(target, argument)
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
          this.addOrder(target, key, value)
        }
      }
    } else if (typeof first === 'string' && first !== '') {
      order = new Order(first)
    }

    if (order) {
      target(order)
    }
  }

  /**
  The clause that withOrder / withLimit attach to: the WITH most
  recently pushed, which must still be the last thing in the pipeline
  (NTS-477)
  */
  private get lastWith(): WithStatement {
    const last = this.statements.at(-1)

    if (!(last instanceof WithStatement)) {
      throw new NeodeError('withOrder()/withLimit() must directly follow a with() call')
    }

    return last
  }

  /**
  Convert a map of properties into inline pattern properties,
  adding each value to the query parameters. `RawExpression` values
  render verbatim instead (NTS-460) — the channel for variable
  references and expressions in patterns; bind their values via
  `param(name, value)` and reference them as `$name`.
  */
  private convertPropertyMap(
    alias: string | undefined,
    properties?: BuilderParameters,
  ): Property[] {
    if (properties === undefined) {
      return []
    }

    return Object.entries(properties).map(([key, value]) => {
      if (value instanceof RawExpression) {
        return new Property(key, value.toString(), '=', true)
      }

      // NTS-609 — pattern parameters go through the same sanitise and
      // collide loop as where parameters: two segments sharing an alias
      // and key (or a key with non-identifier characters) each get their
      // own sanitised, unique name instead of silently overwriting.
      // NTS-605 — the sanitised alias also keeps a hostile property key
      // out of the rendered `$name` reference
      const propertyAlias = this.addParameterNamed(`${String(alias)}_${key}`, value)

      return new Property(key, propertyAlias)
    })
  }

  private whereStringOperator(property: string, value: string, operator: string): this {
    const variable = this.addParameter(property, value)

    this.activeWhereClause.append(
      new Where(quoteReference(property, 'where()'), operator, `$${variable}`),
    )

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
  Shared tail of union() / unionAll() (NTS-687): close the preceding
  branch, reset the scope-boundary state and emit the UNION keyword segment
  */
  private pushUnion(keyword: 'UNION' | 'UNION ALL'): this {
    if (!this.hasReturned) {
      throw new NeodeError(
        'union() needs a RETURN in the branch before it — every UNION branch must end in RETURN',
      )
    }

    this.flush()
    // A branch boundary is a scope boundary: no write->read WITH bridge
    this.afterWriteClause = false
    this.afterDeleteClause = false
    this.hasReturned = false
    this.afterUnion = true

    this.statements.push({ toString: () => keyword })

    return this
  }

  /**
  Compile a sub-builder into a query fragment, namespacing its parameters
  into this builder's parameter space (sub0_, sub1_, …) so nested queries
  never collide with parent or sibling parameters.

  NTS-478 — fail fast: every `$name` reference in the sub-query text must
  resolve to a parameter the sub-builder registered. A raw `$name` that
  was never bound throws here, naming the fragment, instead of surviving
  as an unbound `$subN_name` that only fails at execution
  ("Expected parameter(s): subN_name").

  NTS-492 — the rewrite skips `$name` inside string literals and
  backtick-quoted identifiers, so `$`-bearing text a user quoted into the
  query survives verbatim.
  */
  private compileSub(
    build: (sub: Builder) => Builder,
    imports: string[] = [],
  ): { inner: string; imports: string[] } {
    const sub = new Builder()
    const returned = build(sub)

    const { query, params } = returned.build()
    const prefix = `sub${String(this.subCount++)}_`

    const references = parameterReferences(query)

    // NTS-478 — the check runs against the sub's own parameters: those are
    // exactly the names the rewrite below turns into $subN_x, and any $name
    // missing here would become an unbound $subN_name in the parent query
    const firstUnbound = references.find((reference) => !Object.hasOwn(params, reference.name))

    if (firstUnbound !== undefined) {
      const excerpt = query
        .slice(Math.max(0, firstUnbound.index - 60), firstUnbound.index + 120)
        .trim()

      throw new NeodeError(
        `Unbound parameter $${firstUnbound.name} in a sub-query (call/forEach/countSubquery/collectSubquery/whereExistsSubquery) — register it on the sub-builder before it compiles, e.g. sub.param('${firstUnbound.name}', value). Offending fragment: ${excerpt}`,
      )
    }

    for (const [key, value] of Object.entries(params)) {
      this.params[`${prefix}${key}`] = value
    }

    // NTS-492 — rewrite only the references parameterReferences found:
    // `$name` inside string literals and backtick identifiers is blanked
    // out of those, so quoted text like '%s is $label' survives the
    // namespacing untouched. Rebuilt in one forward pass — the reported
    // indices refer to the original text until each slice consumes it.
    let inner = ''
    let cursor = 0
    for (const { name, index } of references) {
      inner += `${query.slice(cursor, index)}$${prefix}${name}`
      cursor = index + name.length + 1
    }
    inner += query.slice(cursor)

    return { inner, imports }
  }

  /**
  Compile the body of a count / collect aggregate subquery:
  `KIND { [WITH imports] inner }` — shared by the RETURN and WITH
  position channels
  */
  private aggregateSubquery(
    kind: 'COUNT' | 'COLLECT',
    build: (sub: Builder) => Builder,
    imports: string[],
  ): string {
    const { inner, imports: scoped } = this.compileSub(build, imports)
    const scope = scoped.length > 0 ? `WITH ${scoped.join(', ')} ` : ''

    return `${kind} { ${scope}${inner} }`
  }

  /**
  The WITH clause a WITH-position aggregate subquery lands in (NTS-461):
  the trailing WITH clause when nothing is pending after it — so the
  aggregate shares one clause with the variables it must stay alongside —
  otherwise a fresh WITH clause (the NTS-481 shape). Parameters are
  namespaced either way, via aggregateSubquery.
  */
  private withSubqueryExpression(expression: string): this {
    const hasPendingWhere = this.whereClause !== undefined && this.whereClause.toString() !== ''
    const hasPendingStatement = this.current !== undefined && this.current.toString() !== ''
    const last = this.statements.at(-1)

    if (!hasPendingWhere && !hasPendingStatement && last instanceof WithStatement) {
      last.append(expression)

      return this
    }

    this.flush()
    this.afterWriteClause = false
    this.afterDeleteClause = false
    this.statements.push(new WithStatement([expression]))

    return this
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
      // NTS-479: flush the open where clause into the outgoing segment —
      // like match() / with() / create() / merge(), the pending clause
      // belongs to the statement being closed, not the one being opened
      this.whereStatement('WHERE')
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

    // NTS-675 — aliases render verbatim into the pattern (they cannot be
    // escaped without changing meaning), so every pattern method asserts
    // its alias is a plain identifier
    if (alias !== undefined && alias !== '') {
      assertAlias(alias, 'match()')
    }

    this.activeStatement.match(new Match(alias, labels, this.convertPropertyMap(alias, properties)))

    return this
  }

  /**
  Bind the current segment's whole pattern to a path variable — renders as
  `MATCH <variable> = <pattern>` on the segment's MATCH keyword (NTS-593)
  */
  asPath(variable: string): this {
    this.activeStatement.asPath(assertAlias(variable, 'asPath()'))

    return this
  }

  /**
  `MATCH <variable> = shortestPath((from)-[:TYPE]-(to))` (NTS-658): a
  shortest-path match over its own segment, bound to a path variable a
  RETURN can reference (`expr.nodes(variable)`, `expr.relationships(variable)`).
  `direction` defaults to BOTH — shortestPath's common form; `degrees`
  bounds the traversal count — Neo4j rejects a minimum length other than
  0 or 1 inside shortestPath, so bounded forms (`'..2'`, `'1..2'`) are the
  multi-hop spellings and an exact length (`2`) throws naming the fix.
  The variable, from and to arguments are plain variable names (validated
  like aliases — structure, never data). A pinned multi-hop pattern (an
  exact chain of typed edges, where a multi-type shortestPath could return
  a wrong-shaped path) stays with match() / relationship() / to() / asPath().
  */
  shortestPath(
    variable: string,
    from: string,
    to: string,
    options: ShortestPathOptions = {},
  ): this {
    this.whereStatement('WHERE')
    this.statement()
    this.bridgeWriteToRead()

    assertAlias(variable, 'shortestPath()')
    assertAlias(from, 'shortestPath()')
    assertAlias(to, 'shortestPath()')

    const degrees = options.degrees === undefined ? undefined : assertDegrees(options.degrees)

    if (degrees !== undefined) {
      const [minimum] = degrees.split('..', 1)

      if (minimum !== '' && Number(minimum) > 1) {
        throw new NeodeError(
          `Invalid shortestPath degrees "${degrees}" — shortestPath does not support a ` +
            'minimum length other than 0 or 1. Pass a bounded form such as "..2" or "1..2", ' +
            'or pin an exact edge chain with match()/relationship()/to()/asPath().',
        )
      }
    }

    const relationship = new Relationship(
      options.relationship,
      options.direction,
      undefined,
      degrees,
    )

    this.activeStatement.match(
      new PathPattern(`shortestPath((${from})${relationship.toString()}(${to}))`),
    )
    this.activeStatement.asPath(variable)

    return this
  }

  /**
  Add an optional match to the query
  */
  optionalMatch(alias?: string, labels?: string | string[] | false): this {
    this.whereStatement('WHERE')
    this.statement('OPTIONAL MATCH')
    this.bridgeWriteToRead()

    if (alias !== undefined && alias !== '') {
      assertAlias(alias, 'optionalMatch()')
    }

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

  The property is an identifier — it backtick-escapes like every other
  identifier (plain `n.name` references keep their readable rendering,
  NTS-675). The operator validates against the known set (comparison,
  membership, string, regex); use whereRaw() for anything else. Values
  always bind as parameters.
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

      // NTS-675 — the property is an identifier rendered into the
      // predicate (never bindable), so it escapes like every other
      // identifier; plain `n.name`-style references keep their rendering
      const property = quoteReference(first, 'where()')

      if (arguments_.length === 2) {
        // Two arguments: property / value equality
        const variable = this.addParameter(first, arguments_[1])

        this.activeWhereClause.append(new Where(property, OPERATOR_EQUALS, `$${variable}`))
      } else {
        const operator = arguments_[1]

        if (typeof operator !== 'string') {
          throw new TypeError('where() expects a string operator as its second argument')
        }

        const variable = this.addParameter(first, arguments_[2])

        // NTS-675 — the operator renders into the predicate too: validate
        // it against the known set (whereRaw() is the escape hatch)
        this.activeWhereClause.append(
          new Where(property, assertWhereOperator(operator), `$${variable}`),
        )
      }
    }

    return this
  }

  /**
  Property-to-property comparison (NTS-656): both sides are references —
  an alias or `alias.property` — comparing two variables, which where()
  cannot express (every where() value binds as a parameter). Reference
  sides render as quoted identifiers, never parameters; the operator is
  validated against the same set the Where clause renders. Composes with
  or() / whereGroup() like any where clause.
  */
  whereProps(left: string, operator: ComparisonOperator, right: string): this {
    assertComparisonOperator(operator)

    this.activeWhereClause.append(
      new Where(
        quoteReference(left, 'whereProps()'),
        operator,
        quoteReference(right, 'whereProps()'),
      ),
    )

    return this
  }

  /**
  Query on element ID
  */
  whereId(alias: string, value: string | number): this {
    const variable = this.addParameter(`${alias}_id`, value)

    this.activeWhereClause.append(new WhereId(assertAlias(alias, 'whereId()'), variable))

    return this
  }

  /**
  Add a raw where clause. Trusted-input only: the clause renders verbatim
  into the statement — never pass user-supplied text here; bind values as
  parameters (`param(name, value)`) and reference them as `$name`.
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

    this.activeWhereClause.append(
      new WhereBetween(quoteReference(alias, 'whereBetween()'), floorVariable, ceilingVariable),
    )

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

    this.activeWhereClause.append(
      new Where(quoteReference(property, 'whereIn()'), 'IN', `$${variable}`),
    )

    return this
  }

  /**
  Membership test against a reference list (NTS-656): `property IN listRef`,
  where `listRef` is an alias holding a collected list — the reference-side
  counterpart of whereIn (whose values bind as a parameter). Both sides
  render as quoted identifiers.
  */
  whereInRefs(property: string, listReference: string): this {
    return this.whereProps(property, 'IN', listReference)
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
    this.activeWhereClause.append(new WhereNull(quoteReference(property, 'whereNull()')))

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
  Negative pattern predicate (NTS-657): `WHERE NOT (alias)<-[:TYPE]-()` —
  "node with no such relationship" as a pattern predicate. The supported
  form for negative graph patterns: the OPTIONAL MATCH + IS NULL idiom
  silently mis-filters on the embedded engine. No user values flow into
  the pattern, so nothing needs parameterising.
  */
  whereNotPattern(alias: string, type: string, direction?: string): this {
    const relationship = new Relationship(type, direction)

    return this.whereRaw(`NOT (${alias})${relationship.toString()}()`)
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

    assertAlias(alias, 'create()')

    this.activeStatement.match(new Match(alias, labels, this.convertPropertyMap(alias, properties)))

    return this
  }

  /**
  Start a `MERGE` statement. Property values bind as parameters;
  `RawExpression` values render verbatim into the pattern — the channel
  for merging on a FOREACH-bound variable (`{ slug: new RawExpression('slug') }`)
  or an expression (NTS-460).
  */
  merge(alias: string, labels?: string | string[] | false, properties?: BuilderParameters): this {
    this.whereStatement('WHERE')
    this.statement('MERGE')
    this.afterWriteClause = true
    this.afterDeleteClause = false

    assertAlias(alias, 'merge()')

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

        // NTS-675 — the operator renders into the SET clause: validate it
        // (setExpr() is the escape hatch for anything else)
        this.activeStatement.set(property, alias, assertSetOperator(operator))
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

      this.activeStatement.onCreateSet(property, alias, assertSetOperator(operator))
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

      this.activeStatement.onMatchSet(property, alias, assertSetOperator(operator))
    }

    return this
  }

  /**
  Persist a vector property as a plain `SET alias.prop = $param` list —
  the portable form, writable on every engine (the packed storage
  procedure `db.create.setNodeVectorProperty` is server-only and fails on
  embedded engines; NTS-507). The vector index picks SET lists up; the
  bulk path writes the same shape.
  */
  setVectorProperty(alias: string, property: string, value: unknown): this {
    const parameterAlias = `set_${String(this.parameterCount)}`
    this.params[parameterAlias] = value
    this.parameterCount++

    // Backtick-quoted property key: double quotes are string literals,
    // not identifiers — the strict parsers reject them here
    return this.setExpr(`${alias}.${quote(property)}`, `$${parameterAlias}`)
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
    // NTS-463: a RETURN with no preceding clause is a valid standalone
    // statement (e.g. `RETURN COUNT { … } AS found`) — open one lazily
    if (this.current === undefined) {
      this.statement()
    }

    this.activeStatement.return(...values)
    this.hasReturned = true
    this.afterUnion = false

    return this
  }

  /**
  `RETURN DISTINCT …` (NTS-593)
  */
  returnDistinct(...values: string[]): this {
    if (this.current === undefined) {
      this.statement()
    }

    this.activeStatement.returnDistinct(...values)
    this.hasReturned = true
    this.afterUnion = false

    return this
  }

  /**
  `UNION` — combine the rows of the branch built so far with the next one.
  Every branch must end in a return() naming the SAME columns (a Cypher
  requirement); orderBy / skip / limit chained after the FINAL branch's
  return apply to the combined result, matching Neo4j's UNION semantics.

  Branch variables and parameters are independent: a UNION branch is a
  query scope boundary, so the next match() / create() / merge() starts a
  fresh branch (no `WITH *` bridge is injected across the boundary).
  */
  union(): this {
    return this.pushUnion('UNION')
  }

  /**
  `UNION ALL` — union without de-duplication
  */
  unionAll(): this {
    return this.pushUnion('UNION ALL')
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

  The direction validates against ASC / DESC (NTS-675). The field is a raw
  ORDER BY term — it may be any expression (`n.name`, `elementId(n)`,
  `n:Label`), so it cannot be escaped without changing meaning: trusted
  input only. The model-read services escape user-supplied order keys via
  orderTerms() before they reach this; a Builder-level caller passing user
  input must quote it itself (propertyReference()).
  */
  orderBy(...arguments_: unknown[]): this {
    this.addOrder(
      (order) => {
        this.activeStatement.order(order)
      },
      ...arguments_,
    )

    return this
  }

  /**
  ORDER BY attached to the preceding WITH clause (NTS-477): a mid-query
  sort / limit before a write. Accepts the same forms as orderBy.
  */
  withOrder(...arguments_: unknown[]): this {
    this.addOrder(
      (order) => {
        this.lastWith.order(order)
      },
      ...arguments_,
    )

    return this
  }

  /**
  SKIP attached to the preceding WITH clause (NTS-560) — the offset half
  of the WITH-carried ORDER BY / LIMIT trim (withLimit)
  */
  withSkip(skip: number): this {
    this.lastWith.skip(skip)

    return this
  }

  /**
  LIMIT attached to the preceding WITH clause (NTS-477) — the read side
  of a read-modify-write: WITH … ORDER BY … LIMIT n, then the write.
  */
  withLimit(limit: number): this {
    this.lastWith.limit(limit)

    return this
  }

  /**
  Add a relationship pattern to the current statement, optionally
  carrying inline pattern properties — parameterised for plain values,
  rendered verbatim for `RawExpression` values (NTS-460), e.g.
  `relationship('PROVIDED_ANSWER', 'out', 'r', undefined, { correct: row.correct })`.

  @param type  Relationship type, or array of types
  @param direction  Direction of the relationship
  @param alias  Relationship alias
  @param degrees  Number of traversals (1, "1..2", "0..2", "..3")
  @param properties  Inline pattern properties
  */
  relationship(
    type?: string | string[],
    direction?: string,
    alias?: string,
    degrees?: number | string,
    properties?: BuilderParameters,
  ): this {
    if (alias !== undefined && alias !== '') {
      assertAlias(alias, 'relationship()')
    }

    this.activeStatement.match(
      new Relationship(type, direction, alias, degrees, this.convertPropertyMap(alias, properties)),
    )

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

  /**
  Property-existence constraint (`REQUIRE n.prop IS NOT NULL`).
  Enterprise only — Community editions reject the statement at runtime;
  SchemaService gates these on its `isEnterprise` flag.
  */
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
  `CREATE FULLTEXT INDEX … IF NOT EXISTS FOR (n:Label) ON EACH [n.a, n.b]`
  */
  createFulltextIndex(label: string, properties: string[]): this {
    this.flush()
    this.statements.push({
      toString: () => createFulltextStatement({ label, properties }, false),
    })

    return this
  }

  /**
  Drop the full-text index `createFulltextIndex` would install — the
  deterministic name is derived from the same label + properties
  */
  dropFulltextIndex(label: string, properties: string[]): this {
    this.flush()
    this.statements.push({
      toString: () => dropFulltextStatement(fulltextIndexName({ label, properties })),
    })

    return this
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
  `COUNT { … } AS <alias>` in a RETURN position (NTS: grouped and
  conditional counts without hand-written Cypher) — use withCountSubquery
  when the aggregate must feed a later RETURN projection
  */
  countSubquery(alias: string, build: (sub: Builder) => Builder, imports: string[] = []): this {
    return this.return(`${this.aggregateSubquery('COUNT', build, imports)} AS ${alias}`)
  }

  /**
  `COLLECT { … } AS <alias>` in a RETURN position (NTS: collected
  sub-projections without hand-written Cypher) — use withCollectSubquery
  when the aggregate must feed a later RETURN projection
  */
  collectSubquery(alias: string, build: (sub: Builder) => Builder, imports: string[] = []): this {
    return this.return(`${this.aggregateSubquery('COLLECT', build, imports)} AS ${alias}`)
  }

  /**
  `WITH COUNT { … } AS <alias>` (NTS-481): the aggregate is computed per
  input row and stays in scope, so a later return() can project it (e.g.
  `100 * completed / total`) — which a RETURN-position subquery cannot.
  Joins the trailing WITH clause when one is open (NTS-461): `WITH u, e, c`
  followed by two of these renders one `WITH u, e, c, COUNT { … } AS x,
  COUNT { … } AS y` — the carried variables survive and the aggregates
  are filterable (`WHERE x < y`). With nothing to join, it opens its own
  WITH clause. For any other WITH expression the raw escape hatch is
  `with(expr + ' AS alias')`.
  */
  withCountSubquery(alias: string, build: (sub: Builder) => Builder, imports: string[] = []): this {
    return this.withSubqueryExpression(
      `${this.aggregateSubquery('COUNT', build, imports)} AS ${alias}`,
    )
  }

  /**
  `WITH COLLECT { … } AS <alias>` (NTS-481): collected sub-projections in
  WITH position, staying in scope for a later return(). Joins the trailing
  WITH clause when one is open (NTS-461), else opens its own.
  */
  withCollectSubquery(
    alias: string,
    build: (sub: Builder) => Builder,
    imports: string[] = [],
  ): this {
    return this.withSubqueryExpression(
      `${this.aggregateSubquery('COLLECT', build, imports)} AS ${alias}`,
    )
  }

  /**
  `EXISTS { … }` as a composable expression (NTS-465): the compiled
  subquery as a string, for where/or/return positions the clause form
  cannot reach - `or(builder.existsExpr(…))`,
  `NOT ${builder.existsExpr(…)}`, `return(\`… AS alias\`)`. Sub-query
  parameters bind, namespace and fail fast on unbound references exactly
  like whereExistsSubquery.
  */
  existsExpr(build: (sub: Builder) => Builder, imports: string[] = []): string {
    const { inner, imports: scoped } = this.compileSub(build, imports)
    const scope = scoped.length > 0 ? `WITH ${scoped.join(', ')} ` : ''

    return `EXISTS { ${scope}${inner} }`
  }

  /**
  `COLLECT { … }` as a composable expression (NTS-565): the compiled
  subquery as a string, for expression positions the clause form cannot
  reach — the projection service's nested sort rides a WITH-carried
  `COLLECT { … } AS alias`. Sub-query parameters bind, namespace and
  fail fast on unbound references exactly like existsExpr.
  */
  collectExpr(build: (sub: Builder) => Builder, imports: string[] = []): string {
    return this.aggregateSubquery('COLLECT', build, imports)
  }

  /**
  `EXISTS { … }` as a WHERE predicate (NTS: relationship / property
  existence checks without hand-written Cypher)
  */
  whereExistsSubquery(build: (sub: Builder) => Builder, imports: string[] = []): this {
    return this.whereRaw(this.existsExpr(build, imports))
  }

  /**
  Complete a relationship with a target node pattern
  */
  to(alias: string, labels?: string | string[] | false, properties?: BuilderParameters): this {
    assertAlias(alias, 'to()')

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
  Compose a registered model's named read filters into the current where
  segment (NTS-614) — the same fragments every standard read applies, for
  Builder chains over hand-written statements. The filter `where`'s `node`
  convention is rewritten to `alias` (default `this`, the read-root alias
  `hydrate` expects) and each filter's param merges into the statement's
  parameters. Disable per name with `options.withoutFilters`.
  */
  withFilters(model: Newable, alias: string = THIS_NODE, options: ReadFilterOptions = {}): this {
    const modelConstructor: unknown = model
    const schema = getModel(modelConstructor)

    if (schema === undefined) {
      throw new NeodeError(
        `Couldn't find a model for "${model.name}". Register it with @NodeEntity or defineModel() first — withFilters() reads the filters declared on the model.`,
      )
    }

    applyReadFilters(this, schema, options, alias)

    return this
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
    if (this.afterUnion && !this.hasReturned) {
      throw new NeodeError(
        'UNION query ended without a final RETURN — every UNION branch must end in RETURN',
      )
    }

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
