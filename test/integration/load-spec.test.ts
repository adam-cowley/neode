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
class SpecToy {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string
}

@NodeEntity()
class SpecOrder {
  @Uuid({ primary: true })
  id!: string

  @NumberProperty()
  orderDate!: number

  // Non-eager: fetched through a nested load spec level (NTS-154)
  @OneToMany(() => SpecToy, 'FOR', Direction.OUTGOING)
  toys!: SpecToy[]
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

/**
A customer with ONE order holding the given toys — the nested-spec
fixtures (NTS-154)
*/
async function seedOrderWithToys(
  backend: TestBackend,
  toyNames: string[],
): Promise<WithMethods<SpecCustomer>> {
  const customer = await backend.neode.create(SpecCustomer, { name: 'Toyed' })
  const order = await backend.neode.create(SpecOrder, { orderDate: 30 })

  await backend.neode.relate(SpecCustomer, customer, order, 'orders')

  for (const name of toyNames) {
    const toy = await backend.neode.create(SpecToy, { name })

    await backend.neode.relate(SpecOrder, order, toy, 'toys')
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

  it('a PROPERTY key passes the legacy overloads and is rejected at runtime, naming the key', async () => {
    const seeded = await seedCustomer(backend)

    // NTS-154 ceiling: property keys fall through the legacy overload's
    // keyof-T domain (docs/decisions/0002-typing-eager-loads.md) — the
    // runtime validation is the checked edge
    await expect(
      backend.neode.find(SpecCustomer, seeded.id, { with: { name: true } }),
    ).rejects.toThrow('Unknown relationship "name" on SpecCustomer')
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

  it('repository find() threads the load spec through (NTS-563)', async () => {
    const seeded = await seedCustomer(backend)

    const customer = await backend.neode.getRepository(SpecCustomer).find(seeded.id, {
      with: { orders: (relation) => relation.orderBy('orderDate', 'DESC').limit(2) },
    })

    expect(customer).toBeInstanceOf(SpecCustomer)
    expect((customer?.orders as WithMethods<SpecOrder>[]).map((order) => order.orderDate)).toEqual([
      30, 20,
    ])
  })

  it('repository findAll() loads a nested spec level in one statement (NTS-563)', async () => {
    const seeded = await seedOrderWithToys(backend, ['Ball', 'Bone'])

    const customers = await backend.neode
      .getRepository(SpecCustomer)
      .findAll({ name: 'Toyed' }, { with: { orders: { toys: true } } })

    expect(customers).toHaveLength(1)

    const orders = customers[0]?.orders as WithMethods<SpecOrder>[]

    expect(orders).toHaveLength(1)
    expect(orders[0]).toBeInstanceOf(SpecOrder)
    expect((orders[0]?.toys as WithMethods<SpecToy>[]).map((toy) => toy.name)).toEqual(
      expect.arrayContaining(['Ball', 'Bone']),
    )
  })

  it('repository findAll() composes the spec with the named read filters (NTS-162)', async () => {
    const seeded = await seedCustomer(backend)

    // withoutFilters is forwarded verbatim to the same rendering as the
    // facade paths — disabling every named filter changes nothing here (no
    // filter hides the rows) but the composed statement must still hydrate
    const customers = await backend.neode
      .getRepository(SpecCustomer)
      .findAll({}, { with: { orders: true }, withoutFilters: ['softDelete'] })

    expect(customers).toHaveLength(1)
    expect(customers[0]?.orders as WithMethods<SpecOrder>[]).toHaveLength(3)
  })

  it('a nested spec level loads the target’s own relationship in the same statement (NTS-154)', async () => {
    const seeded = await seedOrderWithToys(backend, ['Ball', 'Bone'])

    const customer = await backend.neode.find(SpecCustomer, seeded.id, {
      with: { orders: { toys: true } },
    })

    const orders = customer?.orders as WithMethods<SpecOrder>[]

    expect(orders).toHaveLength(1)
    expect(orders[0]).toBeInstanceOf(SpecOrder)
    expect((orders[0]?.toys as WithMethods<SpecToy>[]).map((toy) => toy.name)).toEqual(
      expect.arrayContaining(['Ball', 'Bone']),
    )
  })

  it('a nested level with a trim (limit) rides the same statement', async () => {
    const seeded = await seedOrderWithToys(backend, ['Ball', 'Bone', 'Chew'])

    const customer = await backend.neode.find(SpecCustomer, seeded.id, {
      with: { orders: { toys: { limit: 1 } } },
    })

    const orders = customer?.orders as WithMethods<SpecOrder>[]

    expect(orders[0]?.toys).toHaveLength(1)
  })

  it('a nested key the target does not declare throws, naming the valid relationships', async () => {
    const seeded = await seedCustomer(backend)

    await expect(
      backend.neode.find(SpecCustomer, seeded.id, {
        with: { orders: { wishlist: true } },
      }),
    ).rejects.toThrow('Relationship "wishlist" is not defined on model "SpecOrder"')
  })
})
