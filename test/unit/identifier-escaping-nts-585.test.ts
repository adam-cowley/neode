import { describe, expect, it } from 'vitest'
import { Expression, Filter, NodeEntity, Property, RelatedOne } from '../../src/decorators'
import type { ConnectionProvider, QueryOutput, QueryRecord, Runner } from '../../src/driver/types'
import { getModel } from '../../src/meta'
import { projectionNode } from '../../src/projection'
import { Builder } from '../../src/query'
import { quoteLabel, quoteLabels } from '../../src/query/quote'
import { labelPattern } from '../../src/services/query/bulk.service'
import { readFilterClauses } from '../../src/services/query/filters'
import { PaginateService } from '../../src/services/query/paginate.service'
import { WithinDistanceService } from '../../src/services/query/within-distance.service'
import {
  ConstraintAction,
  ConstraintType,
  propertyTypeStatement,
  schemaStatement,
} from '../../src/services/schema/schema-objects'
import { schemaDrift } from '../../src/services/schema/drift.service'

/**
 * Identifier escaping follow-ups (NTS-585): node labels, keyset cursor
 * order keys, within-distance location properties, the read-filter `node`
 * alias rewrite, projection keys/fields and DDL names are all escaped —
 * while plain identifiers keep their readable rendering.
 */

const HOSTILE_LABEL = 'X} DETACH DELETE x //'
const QUOTED_LABEL = '`X} DETACH DELETE x //`'
const SPACED = 'My Label'
const QUOTED_SPACED = '`My Label`'

const captureRunner = (captured: string[]): Runner => ({
  run: (query: string) => {
    captured.push(query)

    return Promise.resolve({ records: [] } as unknown as QueryOutput)
  },
})

describe('quoteLabel / quoteLabels (quote.ts)', () => {
  it('leaves plain identifiers readable and escapes everything else', () => {
    expect(quoteLabel('Person')).toBe('Person')
    expect(quoteLabel(SPACED)).toBe(QUOTED_SPACED)
    expect(quoteLabel('a`b')).toBe('`a``b`')
    expect(quoteLabel(HOSTILE_LABEL)).toBe(QUOTED_LABEL)
  })

  it('is idempotent: an already-quoted label passes through as-is', () => {
    expect(quoteLabel(QUOTED_SPACED)).toBe(QUOTED_SPACED)
    expect(quoteLabel(quoteLabel(SPACED))).toBe(QUOTED_SPACED)
    expect(quoteLabel(quoteLabel('a`b'))).toBe('`a``b`')
  })

  it('quoteLabels joins arrays and colon-joined strings without re-quoting', () => {
    expect(quoteLabels(['A', 'B'])).toBe('A:B')
    expect(quoteLabels('A:B')).toBe('A:B')
    expect(quoteLabels(SPACED)).toBe(QUOTED_SPACED)
    expect(quoteLabels(`${QUOTED_SPACED}:B`)).toBe(`${QUOTED_SPACED}:B`)
    // a colon inside a quoted identifier is not a separator
    expect(quoteLabels('`A:B`')).toBe('`A:B`')
    expect(quoteLabels([HOSTILE_LABEL, 'B'])).toBe(`${QUOTED_LABEL}:B`)
  })
})

describe('node labels in patterns (match / create / merge, label-predicate, labelPattern)', () => {
  it('keeps plain labels readable', () => {
    expect(new Builder().match('n', 'Person').return('n').build().query).toBe(
      'MATCH (n:Person)\nRETURN n',
    )
    expect(new Builder().match('n', ['A', 'B']).return('n').build().query).toBe(
      'MATCH (n:A:B)\nRETURN n',
    )
    // the string form may carry several labels
    expect(new Builder().match('n', 'A:B').return('n').build().query).toBe(
      'MATCH (n:A:B)\nRETURN n',
    )
  })

  it('escapes hostile labels and keeps pre-quoted labels as-is', () => {
    expect(new Builder().match('n', SPACED).return('n').build().query).toBe(
      `MATCH (n:${QUOTED_SPACED})\nRETURN n`,
    )
    expect(new Builder().match('n', QUOTED_SPACED).return('n').build().query).toBe(
      `MATCH (n:${QUOTED_SPACED})\nRETURN n`,
    )
    expect(new Builder().match('n', HOSTILE_LABEL).return('n').build().query).toBe(
      `MATCH (n:${QUOTED_LABEL})\nRETURN n`,
    )
    expect(new Builder().create('n', HOSTILE_LABEL).build().query).toBe(
      `CREATE (n:${QUOTED_LABEL})`,
    )
    expect(new Builder().merge('n', HOSTILE_LABEL).build().query).toBe(`MERGE (n:${QUOTED_LABEL})`)
  })

  it('escapes whereLabel and orderByLabel predicates, idempotently', () => {
    const query = (builder: Builder): string => builder.return('n').build().query

    expect(query(new Builder().match('n').whereLabel('n', SPACED))).toBe(
      `MATCH (n)\nWHERE (n:${QUOTED_SPACED})\nRETURN n`,
    )
    expect(query(new Builder().match('n').whereLabel('n', QUOTED_SPACED))).toBe(
      `MATCH (n)\nWHERE (n:${QUOTED_SPACED})\nRETURN n`,
    )
    expect(query(new Builder().match('n').whereLabel('n', HOSTILE_LABEL, true))).toBe(
      `MATCH (n)\nWHERE (NOT n:${QUOTED_LABEL})\nRETURN n`,
    )
    expect(query(new Builder().match('n').orderByLabel('n', HOSTILE_LABEL, 'DESC'))).toBe(
      `MATCH (n)\nRETURN n\nORDER BY n:${QUOTED_LABEL} DESC`,
    )
  })

  it('escapes the bulk labelPattern', () => {
    expect(labelPattern(['Person'])).toBe(':Person')
    expect(labelPattern([SPACED])).toBe(`:${QUOTED_SPACED}`)
    expect(labelPattern([QUOTED_SPACED])).toBe(`:${QUOTED_SPACED}`)
  })
})

describe('keyset cursor orderBy (paginate cursor mode)', () => {
  @NodeEntity()
  class Nts585Doc {
    @Property({ type: 'string' }) 'sort-key': string
  }

  it('escapes a hyphenated cursor property', async () => {
    const captured: string[] = []

    await new PaginateService(captureRunner(captured)).paginate(
      Nts585Doc,
      getModel(Nts585Doc),
      {},
      { limit: 5, orderBy: 'sort-key', after: 'x' },
    )

    const query = captured[0] ?? ''

    expect(query).toContain('this.`sort-key` > $cursor')
    expect(query).toContain('ORDER BY this.`sort-key` ASC')
    expect(query).not.toContain('this.sort-key')
  })

  it('still rejects an undeclared cursor property', async () => {
    await expect(
      new PaginateService(captureRunner([])).paginate(
        Nts585Doc,
        getModel(Nts585Doc),
        {},
        { limit: 5, orderBy: `${HOSTILE_LABEL}-nope`, after: 'x' },
      ),
    ).rejects.toThrow(/Unknown cursor property/)
  })
})

describe('withinDistance locationProperty', () => {
  @NodeEntity()
  class Nts585Place {
    @Property({ type: 'point' }) 'geo-point': { x: number; y: number }
  }

  it('escapes a hyphenated location property', async () => {
    const captured: string[] = []

    await new WithinDistanceService(captureRunner(captured)).withinDistance(
      Nts585Place,
      getModel(Nts585Place),
      'geo-point',
      { x: 1, y: 2 },
      10,
    )

    const query = captured[0] ?? ''

    expect(query).toContain('point.distance(this.`geo-point`, point({ x: 1, y: 2 })) <= 10')
    expect(query).not.toContain('this.geo-point')
  })

  it('escapes the location property when ordering by distance', async () => {
    const captured: string[] = []

    await new WithinDistanceService(captureRunner(captured)).withinDistance(
      Nts585Place,
      getModel(Nts585Place),
      'geo-point',
      { x: 1, y: 2 },
      10,
      {},
      'distance',
    )

    expect(captured[0]).toContain(
      'ORDER BY point.distance(this.`geo-point`, point({ x: 1, y: 2 }))',
    )
  })
})

describe('read-filter `node` alias rewrite (filters.ts)', () => {
  @NodeEntity()
  @Filter({
    name: 'precise',
    where: "x.node = 1 OR node.tenant = $tenant AND NOT node:Archived OR node.name = 'node'",
  })
  class Nts585Filtered {
    @Property({ type: 'string' }) id: string
  }

  @NodeEntity()
  @Filter({
    name: 'boundaries',
    where: 'node.x = 1 OR node2.y = 2 OR anode.z = 3 OR NOT node:Archived OR $node IS NOT NULL',
  })
  class Nts585Boundaries {
    @Property({ type: 'string' }) id: string
  }

  it('rewrites only the node variable, never properties, params, labels or literals', () => {
    const { clauses } = readFilterClauses(getModel(Nts585Filtered), 'this')

    expect(clauses).toEqual([
      "(x.node = 1 OR this.tenant = $tenant AND NOT this:Archived OR this.name = 'node')",
    ])
  })

  it('rewrites whole tokens only (word boundaries, leading node, $node, :node)', () => {
    const { clauses } = readFilterClauses(getModel(Nts585Boundaries), 'this')

    expect(clauses).toEqual([
      '(this.x = 1 OR node2.y = 2 OR anode.z = 3 OR NOT this:Archived OR $node IS NOT NULL)',
    ])
  })
})

describe('projection keys and fields (projection.ts)', () => {
  @NodeEntity()
  class Nts585Owner {
    @Property({ type: 'string' }) name: string

    @Expression('this.`first-name`')
    'expr-key'?: string

    @RelatedOne({ type: 'NAMED', direction: 'out', fields: ['first-name'] })
    'rel-key'?: { 'first-name': string }
  }

  it('quotes hyphenated projection keys and field subsets', () => {
    const fragment = projectionNode('this', getModel(Nts585Owner))

    expect(fragment).toContain('`expr-key`: this.`first-name`')
    expect(fragment).toContain('node.`first-name`')
    expect(fragment).not.toContain('this.expr-key')
    expect(fragment).not.toContain('.expr-key')
  })
})

describe('DDL names (schema-objects, drift.service)', () => {
  it('keeps plain generated names readable', () => {
    expect(
      schemaStatement(ConstraintAction.CREATE, ConstraintType.UNIQUE, 'Person', ['email']),
    ).toBe(
      'CREATE CONSTRAINT person_email_unique IF NOT EXISTS FOR (n:`Person`) REQUIRE n.`email` IS UNIQUE',
    )
    expect(schemaStatement(ConstraintAction.DROP, ConstraintType.UNIQUE, 'Person', ['email'])).toBe(
      'DROP CONSTRAINT person_email_unique IF EXISTS',
    )
  })

  it('escapes a hostile name from SHOW output', () => {
    expect(
      schemaStatement(
        ConstraintAction.CREATE,
        ConstraintType.UNIQUE,
        'Person',
        ['email'],
        HOSTILE_LABEL,
      ),
    ).toBe(
      'CREATE CONSTRAINT ' +
        QUOTED_LABEL +
        ' IF NOT EXISTS FOR (n:`Person`) REQUIRE n.`email` IS UNIQUE',
    )
    expect(
      propertyTypeStatement(ConstraintAction.DROP, 'Person', 'email', 'STRING', HOSTILE_LABEL),
    ).toBe('DROP CONSTRAINT ' + QUOTED_LABEL + ' IF EXISTS')
  })

  it('escapes the name in a drift drop statement', async () => {
    const record = (values: Record<string, unknown>): QueryRecord => ({
      keys: Object.keys(values),
      get: (key) => values[key],
      has: (key) => key in values,
    })

    const connection = {
      run: async (statement: string) => {
        if (statement === 'SHOW CONSTRAINTS') {
          return {
            records: [
              record({
                name: HOSTILE_LABEL,
                type: 'UNIQUE',
                labelsOrTypes: ['Person'],
                properties: ['email'],
              }),
            ],
          }
        }

        return { records: [] }
      },
    } as unknown as ConnectionProvider

    const drift = await schemaDrift(connection)

    expect(drift.constraints.stale[0]?.dropStatement).toBe(
      'DROP CONSTRAINT ' + QUOTED_LABEL + ' IF EXISTS',
    )
  })
})
