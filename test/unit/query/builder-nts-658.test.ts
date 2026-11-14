import { Builder, expr } from '../../../src/query'
import { NeodeError } from '../../../src/errors'

// NTS-658 — shortestPath / path-pattern support: Builder.shortestPath()
// renders `MATCH p = shortestPath((a)-[:TYPE]-(b))` legs, and the pinned
// multi-hop pattern (the third northwind leg) stays expressible through
// match()/relationship()/to()/asPath(). Path variables return through the
// expr.nodes / expr.relationships / expr.type helpers.
describe('Builder.shortestPath (NTS-658)', () => {
  const build = (chain: (builder: Builder) => Builder): { query: string; params: object } =>
    chain(new Builder()).build()

  it('renders an undirected shortestPath with no options', () => {
    const { query, params } = build((b) => b.shortestPath('p', 'a', 'b').return('p'))

    expect(query).toBe('MATCH p = shortestPath((a)--(b))\nRETURN p')
    expect(params).toEqual({})
  })

  it('renders the shared-order leg: typed, bounded at two traversals, both directions', () => {
    // Neo4j rejects a minimum length other than 0 or 1 inside
    // shortestPath, so the "shared order" bound is '..2' (up to 2 hops),
    // not an exact '*2'
    const { query, params } = build((b) =>
      b
        .match('a', 'Product', { productID: 1 })
        .match('b', 'Product', { productID: 2 })
        .shortestPath('p', 'a', 'b', { relationship: 'CONTAINS', degrees: '..2' })
        .return('p'),
    )

    expect(query).toBe(
      'MATCH (a:Product { productID: $a_productID })\n' +
        'MATCH (b:Product { productID: $b_productID })\n' +
        'MATCH p = shortestPath((a)-[:`CONTAINS`*..2]-(b))\n' +
        'RETURN p',
    )
    expect(params).toEqual({ a_productID: 1, b_productID: 2 })
  })

  it('renders the shared-supplier leg shape (second shortestPath call)', () => {
    const { query } = build((b) =>
      b
        .match('a')
        .match('b')
        .shortestPath('p', 'a', 'b', { relationship: 'SUPPLIED_BY', degrees: '..2' })
        .return('p'),
    )

    expect(query).toBe(
      'MATCH (a)\nMATCH (b)\nMATCH p = shortestPath((a)-[:`SUPPLIED_BY`*..2]-(b))\nRETURN p',
    )
  })

  it('renders a directed relationship pattern', () => {
    const { query } = build((b) =>
      b.shortestPath('p', 'a', 'b', { relationship: 'CONTAINS', direction: 'out' }).return('p'),
    )

    expect(query).toBe('MATCH p = shortestPath((a)-[:`CONTAINS`]->(b))\nRETURN p')
  })

  it('rejects an exact traversal minimum — Neo4j: shortestPath supports min 0 or 1 only', () => {
    const builder = new Builder()

    expect(() => builder.shortestPath('p', 'a', 'b', { degrees: 2 })).toThrow(NeodeError)
    expect(() => builder.shortestPath('p', 'a', 'b', { degrees: '2..4' })).toThrow(
      /minimum length other than 0 or 1/,
    )
    // minimum 0 and 1 forms pass validation (rendered correctly)
    expect(() => new Builder().shortestPath('p', 'a', 'b', { degrees: '1..2' })).not.toThrow()
  })

  it('renders multi-type and ranged degrees', () => {
    const { query } = build((b) =>
      b
        .shortestPath('p', 'a', 'b', {
          relationship: ['CONTAINS', 'PLACED_BY'],
          degrees: '..4',
        })
        .return('p'),
    )

    expect(query).toBe('MATCH p = shortestPath((a)-[:`CONTAINS`|`PLACED_BY`*..4]-(b))\nRETURN p')
  })

  it('rejects non-identifier variable, from and to arguments (injection-safe)', () => {
    expect(() => new Builder().shortestPath('p DETACH DELETE x', 'a', 'b')).toThrow(NeodeError)
    expect(() => new Builder().shortestPath('p', 'a) DELETE x //', 'b')).toThrow(NeodeError)
    expect(() => new Builder().shortestPath('p', 'a', '')).toThrow(NeodeError)
  })
})

describe('path-variable returns (NTS-658)', () => {
  const build = (chain: (builder: Builder) => Builder): { query: string; params: object } =>
    chain(new Builder()).build()

  it('expr.nodes / expr.relationships / expr.type compose into the RETURN', () => {
    const { query } = build((b) =>
      b
        .match('a')
        .match('b')
        .shortestPath('p', 'a', 'b', { relationship: 'CONTAINS', degrees: '..2' })
        .return(
          `[n IN ${expr.nodes('p')} | n.name] AS names`,
          `[r IN ${expr.relationships('p')} | ${expr.type('r')}] AS types`,
        ),
    )

    expect(query).toBe(
      'MATCH (a)\nMATCH (b)\nMATCH p = shortestPath((a)-[:`CONTAINS`*..2]-(b))\n' +
        'RETURN [n IN nodes(p) | n.name] AS names, [r IN relationships(p) | type(r)] AS types',
    )
  })
})

describe('pinned multi-hop path pattern (NTS-658)', () => {
  it('binds an exact typed edge chain to a path variable with asPath()', () => {
    // The northwind shared-customer leg: a multi-type shortestPath over
    // these types can return a customer-less Product-Order-Product chain,
    // so the exact 4-edge pattern is pinned instead
    const { query, params } = new Builder()
      .match('a', 'Product', { productID: 1 })
      .relationship('CONTAINS', 'in')
      .to('o1', 'Order')
      .relationship('PLACED_BY', 'out')
      .to('c', 'Customer')
      .relationship('PLACED_BY', 'in')
      .to('o2', 'Order')
      .relationship('CONTAINS', 'out')
      .to('b', 'Product', { productID: 2 })
      .asPath('p')
      .return('p')
      .build()

    expect(query).toBe(
      'MATCH p = (a:Product { productID: $a_productID })<-[:`CONTAINS`]-(o1:Order)' +
        '-[:`PLACED_BY`]->(c:Customer)<-[:`PLACED_BY`]-(o2:Order)-[:`CONTAINS`]->(b:Product { productID: $b_productID })\n' +
        'RETURN p',
    )
    expect(params).toEqual({ a_productID: 1, b_productID: 2 })
  })
})
