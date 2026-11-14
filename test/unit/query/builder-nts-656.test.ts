import { Builder } from '../../../src/query'
import { NeodeError } from '../../../src/errors'

// NTS-656 — property-to-property comparison predicates: whereProps /
// whereInRefs compare two REFERENCES (alias or alias.property) — quoted
// identifiers, never parameters — which where() cannot express (every
// where() value binds as $param).
describe('Builder.whereProps / whereInRefs (NTS-656)', () => {
  const build = (chain: (builder: Builder) => Builder): { query: string; params: object } =>
    chain(new Builder()).build()

  it.each(['=', '<>', '<', '<=', '>', '>='] as const)(
    'renders %s between two references',
    (operator) => {
      const { query, params } = build((b) =>
        b
          .match('p', 'Product')
          .whereProps('p.unitsInStock', operator, 'p.reorderLevel')
          .return('p'),
      )

      expect(query).toBe(
        `MATCH (p:Product)\nWHERE (p.unitsInStock ${operator} p.reorderLevel)\nRETURN p`,
      )
      // reference sides are structure — no parameter is registered
      expect(params).toEqual({})
    },
  )

  it('keeps plain aliases readable (alias-to-alias comparison)', () => {
    const { query } = build((b) => b.match('c').match('other').whereProps('other', '<>', 'c'))

    expect(query).toBe('MATCH (c)\nMATCH (other)\nWHERE (other <> c)')
  })

  it('whereInRefs renders set membership against a reference list', () => {
    const { query, params } = build((b) =>
      b.match('p2', 'Product').whereInRefs('p2', 'mine').return('p2'),
    )

    expect(query).toBe('MATCH (p2:Product)\nWHERE (p2 IN mine)\nRETURN p2')
    expect(params).toEqual({})
  })

  it('escapes hostile reference sides as quoted identifiers (injection-safe)', () => {
    const { query } = build((b) =>
      b.match('n').whereProps('n.ok; DETACH DELETE x', '=', 'n.other `weird`'),
    )

    expect(query).toBe('MATCH (n)\nWHERE (n.`ok; DETACH DELETE x` = n.`other ``weird```)')
  })

  it('escapes a hostile property key on an alias side', () => {
    const { query } = build((b) => b.match('p').whereProps('p.weird key', '<=', 'p.reorderLevel'))

    expect(query).toBe('MATCH (p)\nWHERE (p.`weird key` <= p.reorderLevel)')
  })

  it('rejects empty reference segments', () => {
    const builder = new Builder().match('n')

    expect(() => builder.whereProps('a..b', '=', 'c')).toThrow(NeodeError)
    expect(() => builder.whereInRefs('', 'mine')).toThrow(NeodeError)
  })

  it('rejects an operator outside the comparison set', () => {
    const builder = new Builder().match('n')

    expect(() => builder.whereProps('a', '=~', 'b')).toThrow(NeodeError)
    expect(() => builder.whereProps('a', '=~', 'b')).toThrow(
      /supported operators are =, <>, <, <=, >, >=, IN/,
    )
  })

  it('composes with or()', () => {
    const { query, params } = build((b) =>
      b
        .match('n', 'Person')
        .where('n.name', 'Adam')
        .or()
        .whereProps('n.age', '<', 'n.limit')
        .return('n'),
    )

    expect(query).toBe(
      'MATCH (n:Person)\nWHERE (n.name = $where_n_name OR n.age < n.limit)\nRETURN n',
    )
    expect(params).toEqual({ where_n_name: 'Adam' })
  })

  it('composes with whereGroup()', () => {
    const { query } = build((b) =>
      b
        .match('p', 'Product')
        .where('p.discontinued', false)
        .or()
        .whereGroup((g) => g.whereProps('p.unitsInStock', '<=', 'p.reorderLevel'))
        .return('p'),
    )

    expect(query).toBe(
      'MATCH (p:Product)\nWHERE (p.discontinued = $where_p_discontinued OR (p.unitsInStock <= p.reorderLevel))\nRETURN p',
    )
  })

  it('reference sides are structure for the NTS-478 unbound-param scan — a sub-query containing them compiles', () => {
    const builder = new Builder().match('a', 'A').with('a', 'collect(a) AS mine')

    builder.call((sub) => sub.match('p', 'Product').whereInRefs('p', 'mine').return('p'), ['mine'])

    const { query, params } = builder.build()

    expect(query).toContain('WHERE (p IN mine)')
    expect(params).toEqual({})
  })
})
