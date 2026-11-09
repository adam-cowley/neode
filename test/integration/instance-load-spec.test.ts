import { openBackend, TestBackend } from './support/backend'
import { setDefaultNeode } from '../../src/entity-methods'
import type { WithMethods } from '../../src/entity-methods'
import {
  Filter,
  InternalId,
  NodeEntity,
  OneToMany,
  OneToOne,
  Property,
  String,
  Uuid,
} from '../../src/decorators'
import { Direction } from '../../src/query'
import { EventType } from '../../src/common/events'
import { setFilterParams, clearFilterParams } from '../../src/services/query/filters'
import { NeodeError } from '../../src/errors'
import type { QueryExecutedEvent } from '../../src/common/events'

// ---- Fixtures (per-file: decorator registry is global per module) -----------

// The tenant filter is active for the whole file (the param store is
// global) — every seeded line carries the file tenant so the other tests
// read through it untouched
const FILE_TENANT = 'spec-498-tenant'

@Filter({ name: 'tenant', where: 'node.tenant = $tenant' })
@NodeEntity()
class Line {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  label: string

  @Property({ type: 'number' })
  position: number

  @Property({ type: 'string' })
  tenant: string
}

@NodeEntity()
class Order {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'number' })
  placedAt: number

  @OneToMany(() => Line, 'CONTAINS', Direction.OUTGOING)
  lines: Line[]
}

@NodeEntity()
class Card {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  code: string
}

@NodeEntity()
class Customer {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  name: string

  @OneToMany(() => Order, 'PLACED', Direction.OUTGOING)
  orders: Order[]

  @OneToOne({ type: 'LOYALTY', target: () => Card, direction: Direction.OUTGOING })
  card: Card | undefined
}

// ---------------------------------------------------------------------------

describe('instance.load(spec) — multi-key, multi-level per-instance load (NTS-498)', () => {
  let backend: TestBackend
  let executed: QueryExecutedEvent[]

  const onQuery = (event: QueryExecutedEvent): void => {
    executed.push(event)
  }

  beforeAll(async () => {
    backend = await openBackend()

    setDefaultNeode(backend.neode)
    setFilterParams('tenant', FILE_TENANT)
  })

  beforeEach(() => {
    executed = []

    backend.neode.on(EventType.QUERY_EXECUTED, onQuery)
  })

  afterEach(async () => {
    backend.neode.off(EventType.QUERY_EXECUTED, onQuery)

    await backend.clearGraph()
  })

  afterAll(async () => {
    clearFilterParams()

    await backend.close()
  })

  /** A saved customer; orders of [placedAt, lineCount], freshly re-found */
  async function seededCustomer(
    orders: Array<{ placedAt: number; lines: number }>,
    withCard = false,
  ): Promise<WithMethods<Customer>> {
    const customer = new Customer()
    customer.name = `customer-${Math.random()}`

    const savedCustomer = (await backend.neode.save(customer)) as WithMethods<Customer>

    for (const { placedAt, lines } of orders) {
      const order = new Order()
      order.placedAt = placedAt

      const savedOrder = (await backend.neode.save(order)) as WithMethods<Order>

      await savedCustomer.relateTo(savedOrder, 'orders')

      for (let position = 1; position <= lines; position += 1) {
        const line = new Line()
        line.label = `line-${placedAt}-${position}`
        line.position = position
        line.tenant = FILE_TENANT

        const savedLine = (await backend.neode.save(line)) as WithMethods<Line>

        await savedOrder.relateTo(savedLine, 'lines')
      }
    }

    if (withCard) {
      const card = new Card()
      card.code = `CARD-${Math.random()}`

      const savedCard = (await backend.neode.save(card)) as WithMethods<Card>

      await savedCustomer.relateTo(savedCard, 'card')
    }

    return (await backend.neode.find(Customer, savedCustomer.id)) as WithMethods<Customer>
  }

  it('hydrates multi-key + nested specs, one read per root key', async () => {
    const found = await seededCustomer(
      [
        { placedAt: 10, lines: 2 },
        { placedAt: 20, lines: 1 },
      ],
      true,
    )

    executed = []

    await found.load({ orders: { lines: true }, card: true })

    // One traversal statement per root key — nested levels ride the
    // statement's projection, they do not N+1 per entity
    expect(executed).toHaveLength(2)

    expect(found.orders).toHaveLength(2)
    for (const order of found.orders) {
      expect(order).toBeInstanceOf(Order)
      expect(order.lines.length).toBeGreaterThan(0)

      for (const line of order.lines) {
        expect(line).toBeInstanceOf(Line)
      }
    }

    expect(found.card).toBeInstanceOf(Card)
  })

  it('honours per-level order/limit: newest-3 orders each with their newest-2 lines', async () => {
    const found = await seededCustomer([
      { placedAt: 10, lines: 3 },
      { placedAt: 20, lines: 3 },
      { placedAt: 30, lines: 3 },
      { placedAt: 40, lines: 3 },
    ])

    executed = []

    await found.load({
      orders: {
        order: { placedAt: 'DESC' },
        limit: 3,
        lines: { order: { position: 'DESC' }, limit: 2 },
      },
    })

    expect(found.orders.map((order) => order.placedAt)).toEqual([40, 30, 20])

    for (const order of found.orders) {
      expect(order.lines.map((line) => line.position)).toEqual([3, 2])
    }

    // The whole tree read in ONE statement — the nested trim rides the
    // projection, not a per-entity round trip
    expect(executed).toHaveLength(1)
  })

  it('honours per-level skip', async () => {
    const found = await seededCustomer([
      { placedAt: 10, lines: 1 },
      { placedAt: 20, lines: 1 },
      { placedAt: 30, lines: 1 },
    ])

    executed = []

    await found.load({ orders: { order: { placedAt: 'DESC' }, skip: 1, limit: 1 } })

    expect(found.orders.map((order) => order.placedAt)).toEqual([20])
  })

  it('materializes the loaded values as own properties — later reads never re-query', async () => {
    const found = await seededCustomer([{ placedAt: 10, lines: 1 }])

    executed = []

    await found.load({ orders: { lines: true } })

    expect(executed).toHaveLength(1)

    expect(Object.hasOwn(found, 'orders')).toBe(true)
    expect(Object.hasOwn(found.orders[0], 'lines')).toBe(true)

    // Re-reading is pure memory — no statement runs
    expect(found.orders[0].lines[0].label).toContain('line-10-1')
    expect(executed).toHaveLength(1)
  })

  it('rejects an undeclared key at depth, naming the valid keys at that level', async () => {
    const found = await seededCustomer([{ placedAt: 10, lines: 1 }])

    executed = []

    await expect(found.load({ orders: { wishlist: true } })).rejects.toThrow(
      'Relationship "wishlist" is not defined on model "Order"',
    )
    await expect(found.load({ orders: { wishlist: true } })).rejects.toThrow('lines')

    // …and at the root, nothing ran (the whole spec validates first)
    expect(executed).toHaveLength(0)
  })

  it('rejects a spec that is not an object of keys', async () => {
    const found = await seededCustomer([])

    await expect(found.load(3 as unknown as { orders: true })).rejects.toThrow(NeodeError)
  })

  it('reads filtered-out targets as empty collections — the parent survives', async () => {
    const found = await seededCustomer([
      { placedAt: 10, lines: 2 },
      { placedAt: 20, lines: 1 },
    ])

    // The second order's only line goes foreign-tenant: filtered out, the
    // order row itself survives (pattern comprehension, never OPTIONAL MATCH)
    await backend.neode.writeCypher(
      'MATCH (l:Line) WHERE l.tenant = $fileTenant AND l.label CONTAINS $prefix SET l.tenant = $other',
      { fileTenant: FILE_TENANT, other: 'tenant-other', prefix: 'line-20-' },
    )

    executed = []

    await found.load({ orders: { lines: true } })

    expect(executed).toHaveLength(1)

    expect(found.orders).toHaveLength(2)

    const first = found.orders.find((order) => order.placedAt === 10)
    const second = found.orders.find((order) => order.placedAt === 20)

    expect(first?.lines).toHaveLength(2)
    expect(second?.lines).toEqual([])
  })
})
