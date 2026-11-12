// NTS-658 — shortestPath / path-pattern support against a real backend:
// the Builder renders shortestPath() legs and the pinned multi-hop
// pattern, and the pinned pattern cannot produce the wrong-shaped path
// the multi-type shortestPath pitfall produces (a customer-less
// Product-Order-Product chain — the northwind product-links comment).
import { Builder, expr } from '../../src/query'
import { openBackend, TestBackend } from './support/backend'

// The labels of every node along the bound path, in path order — the
// shape assertion: a shared-order path reads Product-Order-Product, the
// pinned shared-customer path Product-Order-Customer-Order-Product
const kinds = `[n IN ${expr.nodes('p')} | labels(n)[0]] AS kinds`

describe('shortestPath / pinned path patterns (NTS-658) — integration', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  /**
  Northwind-shaped fixture: two products sharing an order (the
  shared-order leg) AND a customer (through two other orders), so a
  multi-type shortestPath and the pinned pattern disagree on the shape
  they return.
  */
  const seed = async (): Promise<void> => {
    await backend.connection.run(
      [
        'CREATE (p1:Product { productID: 1 })<-[:CONTAINS]-(:Order { orderID: 100 })-[:CONTAINS]->(p2:Product { productID: 2 })',
        'CREATE (o2:Order { orderID: 101 })-[:CONTAINS]->(p1)',
        'CREATE (o3:Order { orderID: 102 })-[:CONTAINS]->(p2)',
        "CREATE (c:Customer { customerID: 'ALFKI' })",
        'CREATE (o2)-[:PLACED_BY]->(c), (o3)-[:PLACED_BY]->(c)',
      ].join('\n'),
    )
  }

  const matchProducts = (builder: Builder): Builder =>
    builder
      .match('a', 'Product')
      .where('a.productID', 1)
      .match('b', 'Product')
      .where('b.productID', 2)

  it('the shortestPath leg finds the shared order path', async () => {
    await seed()

    const output = await backend.neode.read(
      matchProducts(new Builder())
        .shortestPath('p', 'a', 'b', { relationship: 'CONTAINS', degrees: '..2' })
        .return(kinds, `[r IN ${expr.relationships('p')} | ${expr.type('r')}] AS types`),
    )

    const row = output.records[0]
    expect(row.get('kinds')).toEqual(['Product', 'Order', 'Product'])
    expect(row.get('types')).toEqual(['CONTAINS', 'CONTAINS'])
  })

  it('the pinned multi-hop pattern returns the shared-customer path — the wrong shape the multi-type pitfall produces stays impossible', async () => {
    await seed()

    // The pitfall: a multi-type shortestPath over CONTAINS|PLACED_BY
    // happily returns the customer-less Product-Order-Product chain (via
    // the shared order), never touching the customer — a bounded
    // multi-hop search (..4) is what a "how are these connected" query
    // naively reaches for
    const pitfall = await backend.neode.read(
      matchProducts(new Builder())
        .shortestPath('p', 'a', 'b', {
          relationship: ['CONTAINS', 'PLACED_BY'],
          degrees: '..4',
        })
        .return(kinds),
    )

    expect(pitfall.records[0].get('kinds')).toEqual(['Product', 'Order', 'Product'])

    // The pinned 4-edge pattern cannot produce that wrong shape: every
    // match runs through a Customer
    const pinned = await backend.neode.read(
      new Builder()
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
        .return(kinds, 'c.customerID AS customerID'),
    )

    expect(pinned.records.map((row) => row.get('kinds'))).toEqual([
      ['Product', 'Order', 'Customer', 'Order', 'Product'],
    ])
    expect(pinned.records[0].get('customerID')).toBe('ALFKI')
  })
})
