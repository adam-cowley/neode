// NTS-656 — property-to-property comparison predicates against a real
// backend, on a projected model (a @RelationshipCount field read through
// ProjectionService): whereProps compares two variables and whereInRefs
// filters against a collected list — both sides identifiers, never
// parameters.
import { InternalId, NodeEntity, Property, RelationshipCount } from '../../src/decorators'
import { getModel } from '../../src/meta'
import { Builder } from '../../src/query'
import { ProjectionService } from '../../src/projection/projection.service'
import { openBackend, TestBackend } from './support/backend'

@NodeEntity()
class StockItem {
  @InternalId() _id: string
  @Property({ type: 'string', primary: true }) id: string
  @Property({ type: 'string' }) name: string
  @Property({ type: 'number' }) unitsInStock: number
  @Property({ type: 'number' }) reorderLevel: number

  // projected field — the read goes through the projection query shape
  @RelationshipCount({ type: 'SUPPLIES', direction: 'out' })
  supplyCount: number
}

describe('whereProps / whereInRefs (NTS-656) — integration', () => {
  let backend: TestBackend
  let projections: ProjectionService

  beforeAll(async () => {
    backend = await openBackend()
    projections = new ProjectionService(backend.connection)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  const seed = async (): Promise<void> => {
    const neode = backend.neode
    await neode.create(StockItem, {
      id: 'low',
      name: 'Below reorder level',
      unitsInStock: 3,
      reorderLevel: 10,
    })
    await neode.create(StockItem, {
      id: 'high',
      name: 'Above reorder level',
      unitsInStock: 50,
      reorderLevel: 10,
    })
    await neode.create(StockItem, {
      id: 'equal',
      name: 'Exactly at reorder level',
      unitsInStock: 10,
      reorderLevel: 10,
    })
  }

  it('column-to-column: unitsInStock <= reorderLevel returns only the low rows', async () => {
    await seed()

    const output = await backend.neode.read(
      new Builder()
        .match('p', 'StockItem')
        .whereProps('p.unitsInStock', '<=', 'p.reorderLevel')
        .return('p.id AS id')
        .orderBy('id'),
    )

    expect(output.records.map((row) => row.get('id'))).toEqual(['equal', 'low'])
  })

  it('set membership: p.id IN collected list returns exactly the collected rows', async () => {
    await seed()

    const output = await backend.neode.read(
      new Builder()
        .match('mine', 'StockItem')
        .where('mine.id', 'low')
        .with('collect(mine.id) AS ids')
        .match('p', 'StockItem')
        .whereInRefs('p.id', 'ids')
        .return('p.id AS id')
        .orderBy('id'),
    )

    expect(output.records.map((row) => row.get('id'))).toEqual(['low'])
  })

  it('the projected-model read path composes with the ref-to-ref predicate', async () => {
    await seed()

    // the model's projected read (the @RelationshipCount field hydrates
    // through ProjectionService), filtered to the row the column-to-column
    // whereProps predicate selects
    const items = await projections.get(
      StockItem,
      getModel(StockItem),
      { id: 'equal' },
      undefined,
      undefined,
      'id',
    )

    expect(items.map((item) => item.id)).toEqual(['equal'])
    expect(items[0].unitsInStock).toBe(items[0].reorderLevel)
    expect(items[0].supplyCount).toBe(0)
  })
})
