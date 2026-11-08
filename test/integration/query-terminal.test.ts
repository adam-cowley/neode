// The backend import loads neode.service first, resolving the module cycles
// before anything below is evaluated
import { openBackend, TestBackend } from './support/backend'
import { Builder } from '../../src/query'

// NTS-554 — Neode#query(): Builder bound to the instance with .read()/.write()
describe('Neode#query() fluent chain — integration', () => {
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

  it('a chained query returns the same rows as the equivalent explicit Builder', async () => {
    await backend.neode.write(
      'CREATE (:Order { id: "o1" })-[:CONTAINS]->(:Product { name: "Widget" })',
    )

    const chained = await backend.neode
      .query()
      .match('o', 'Order')
      .relationship('CONTAINS', 'out', 'line')
      .to('p', 'Product')
      .return('o.id AS order', 'p.name AS product')
      .read()

    const explicit = await backend.neode.read(
      new Builder()
        .match('o', 'Order')
        .relationship('CONTAINS', 'out', 'line')
        .to('p', 'Product')
        .return('o.id AS order', 'p.name AS product'),
    )

    expect(chained.records).toHaveLength(1)
    expect(chained.records[0].get('product')).toBe('Widget')
    expect(chained.records.map((record) => record.get('order'))).toEqual(
      explicit.records.map((record) => record.get('order')),
    )
  })

  it('tx.query()...write() inside inWriteTransaction commits', async () => {
    await backend.neode.inWriteTransaction(async (tx) => {
      await tx.query().create('p', 'ChainedOrder', { id: 'o1' }).write()

      await tx.commit()

      return null
    })

    const found = await backend.neode.read(
      new Builder().match('p', 'ChainedOrder').where('p.id', 'o1').return('count(p) AS c'),
    )

    expect(Number(found.records[0].get('c'))).toBe(1)
  })
})
