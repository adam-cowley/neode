import {
  NodeEntity,
  Number as NumberProperty,
  OneToMany,
  OneToOne,
  Property,
  Uuid,
} from '../../src/decorators'
import { Direction } from '../../src/query'
import { setStrictRelationAccess } from '../../src/strict-relation-access'
import type { WithMethods } from '../../src/entity-methods'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class SpecOrder {
  @Uuid({ primary: true })
  id!: string

  @NumberProperty()
  orderDate!: number
}

@NodeEntity()
class SpecCard {
  @Property({ type: 'string' })
  code!: string
}

@NodeEntity()
class SpecCustomer {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string

  // Non-eager: fetched through the load spec / instance.load()
  @OneToMany(() => SpecOrder, 'PLACED', Direction.OUTGOING)
  orders!: SpecOrder[]

  @OneToOne({ type: 'HAS_CARD', target: () => SpecCard, direction: Direction.OUTGOING })
  card!: SpecCard | undefined
}

const ORDER_DATES = [30, 10, 20]

async function seedCustomer(
  backend: TestBackend,
  withCard = false,
): Promise<WithMethods<SpecCustomer>> {
  const customer = await backend.neode.create(SpecCustomer, { name: 'Adam' })

  for (const orderDate of ORDER_DATES) {
    const order = await backend.neode.create(SpecOrder, { orderDate })

    await backend.neode.relate(SpecCustomer, customer, order, 'orders')
  }

  if (withCard) {
    const card = await backend.neode.create(SpecCard, { code: 'GOLD' })

    await backend.neode.relate(SpecCustomer, customer, card, 'card')
  }

  return customer
}

// NTS-560 — the `with` load spec on find / findAll / all
describe('load spec (`with`) — integration', () => {
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

  it('find(..., { with: { orders: limit 2 } }) returns the customer with exactly the 2 newest orders hydrated', async () => {
    const seeded = await seedCustomer(backend)

    const customer = await backend.neode.find(SpecCustomer, seeded.id, {
      with: {
        orders: (relation) => relation.orderBy('orderDate', 'DESC').limit(2),
      },
    })

    expect(customer).toBeInstanceOf(SpecCustomer)

    const orders = customer?.orders as WithMethods<SpecOrder>[]

    expect(orders).toHaveLength(2)
    expect(orders.map((order) => order.orderDate)).toEqual([30, 20])

    for (const order of orders) {
      expect(order).toBeInstanceOf(SpecOrder)
    }
  })

  it('a plain `true` request loads every related entity of a non-eager relationship', async () => {
    const seeded = await seedCustomer(backend)

    const customer = await backend.neode.find(SpecCustomer, seeded.id, {
      with: { orders: true },
    })

    expect((customer?.orders as WithMethods<SpecOrder>[]).map((order) => order.orderDate)).toEqual(
      expect.arrayContaining(ORDER_DATES),
    )
  })

  it('a decorated OneToOne resolves to the entity', async () => {
    const seeded = await seedCustomer(backend, true)

    const customer = await backend.neode.find(SpecCustomer, seeded.id, {
      with: { card: (relation) => relation.limit(1) },
    })

    expect(customer?.card).toBeInstanceOf(SpecCard)
    expect((customer?.card as WithMethods<SpecCard>).code).toBe('GOLD')
  })

  it('an empty relation materializes [] (loaded-and-empty)', async () => {
    const customer = await backend.neode.create(SpecCustomer, { name: 'Bare' })

    const found = await backend.neode.find(SpecCustomer, customer.id, {
      with: { orders: true },
    })

    expect(found?.orders).toEqual([])
    expect(Object.hasOwn(found as object, 'orders')).toBe(true)
  })

  it('the spec materializes own properties, resolving the strict-access guard', async () => {
    const seeded = await seedCustomer(backend)

    setStrictRelationAccess(true)

    try {
      const customer = await backend.neode.find(SpecCustomer, seeded.id, {
        with: { orders: (relation) => relation.orderBy('orderDate', 'DESC').limit(2) },
      })

      // The requested key was materialized — no guard fires
      expect(customer?.orders).toHaveLength(2)
    } finally {
      setStrictRelationAccess(false)
    }
  })

  it('all(..., { with }) honors the spec', async () => {
    await seedCustomer(backend)

    const customers = await backend.neode.all<SpecCustomer>(
      SpecCustomer,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      {
        with: { orders: (relation) => relation.orderBy('orderDate', 'DESC').limit(1) },
      },
    )

    expect(customers).toHaveLength(1)
    expect(
      (customers[0]?.orders as WithMethods<SpecOrder>[]).map((order) => order.orderDate),
    ).toEqual([30])
  })

  it('a spec key the model does not declare throws, naming the model and key', async () => {
    const seeded = await seedCustomer(backend)

    await expect(
      backend.neode.find(SpecCustomer, seeded.id, { with: { wishlists: true } }),
    ).rejects.toThrow('Unknown relationship "wishlists" on SpecCustomer')
  })

  it('repository findAll() threads the load spec through', async () => {
    const seeded = await seedCustomer(backend)

    const customers = await backend.neode.getRepository(SpecCustomer).findAll(
      {},
      {
        with: { orders: (relation) => relation.orderBy('orderDate', 'DESC').limit(2) },
      },
    )

    expect(customers).toHaveLength(1)
    expect(
      (customers[0]?.orders as WithMethods<SpecOrder>[]).map((order) => order.orderDate),
    ).toEqual([30, 20])
  })
})
