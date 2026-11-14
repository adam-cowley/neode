import { openBackend, TestBackend } from './support/backend'
import { setDefaultNeode } from '../../src/entity-methods'
import type { WithMethods } from '../../src/entity-methods'
import { InternalId, NodeEntity, OneToMany, OneToOne, Property, Uuid } from '../../src/decorators'
import { Direction } from '../../src/query'
import { NeodeError, RelationNotLoadedError } from '../../src/errors'
import { setStrictRelationAccess } from '../../src/strict-relation-access'
import { EventType } from '../../src/common/events'
import type { QueryExecutedEvent } from '../../src/common/events'

// ---- Fixtures (per-file: decorator registry is global per module) -----------

@NodeEntity()
class Order {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'number' })
  total: number
}

@NodeEntity()
class LoyaltyCard {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  code: string
}

// Not eager on purpose (NTS-558): the lazy loader is the missing half of
// keeping list payloads lean on Customer-style parents
@NodeEntity()
class Customer {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string

  @OneToMany(() => Order, 'PLACED', Direction.OUTGOING)
  orders: Order[]

  @OneToOne({ type: 'LOYALTY', target: () => LoyaltyCard, direction: Direction.OUTGOING })
  card: LoyaltyCard | undefined
}

// ---------------------------------------------------------------------------

describe('instance.load(key) — lazy relation loader (NTS-558)', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()

    setDefaultNeode(backend.neode)
  })

  afterEach(async () => {
    setStrictRelationAccess(false)

    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  /** A saved customer with one related order per total, freshly re-found */
  async function seededCustomer(
    totals: number[],
  ): Promise<{ found: WithMethods<Customer>; savedId: string }> {
    const customer = new Customer()
    customer.name = `customer-${totals.join('-')}-${Math.random()}`

    const savedCustomer = (await backend.neode.save(customer)) as WithMethods<Customer>

    for (const total of totals) {
      const order = new Order()
      order.total = total

      const saved = (await backend.neode.save(order)) as WithMethods<Order>

      await savedCustomer.relateTo(saved, 'orders')
    }

    const found = (await backend.neode.find(Customer, savedCustomer.id)) as WithMethods<Customer>

    return { found, savedId: savedCustomer.id }
  }

  it('lazy-loads a non-eager OneToMany and materializes it as an own property', async () => {
    const { found } = await seededCustomer([10, 20, 30])

    // Not loaded: lenient mode reads undefined
    expect(found.orders).toBeUndefined()

    const loaded = await found.load('orders')

    expect(loaded).toHaveLength(3)
    for (const order of loaded) {
      expect(order).toBeInstanceOf(Order)
    }

    // The result is materialized as an own property — reading it again
    // needs no second load, and Object.hasOwn proves it is not the
    // prototype accessor answering
    expect(Object.hasOwn(found, 'orders')).toBe(true)
    expect(found.orders).toHaveLength(3)
    expect(found.orders[0]).toBeInstanceOf(Order)
  })

  it('pushes order/limit/skip into the traversal (sorted, truncated result)', async () => {
    const { found } = await seededCustomer([30, 10, 20])

    const topTwo = await found.load('orders', { order: { total: 'DESC' }, limit: 2 })

    expect(topTwo.map((order) => order.total)).toEqual([30, 20])

    const secondPage = await found.load('orders', { order: 'total', skip: 1, limit: 1 })

    expect(secondPage.map((order) => order.total)).toEqual([20])
  })

  it('lazy-loads a OneToOne: the entity, or undefined when the graph answers empty', async () => {
    const { found } = await seededCustomer([10])

    const card = new LoyaltyCard()
    card.code = `CARD-${Math.random()}`

    const savedCard = (await backend.neode.save(card)) as WithMethods<LoyaltyCard>

    await found.relateTo(savedCard, 'card')

    const reFound = (await backend.neode.find(Customer, found.id)) as WithMethods<Customer>

    const loaded = await reFound.load('card')

    expect(loaded).toBeInstanceOf(LoyaltyCard)
    expect(reFound.card).toBeInstanceOf(LoyaltyCard)

    // A customer with no card: the loaded-and-empty shape is undefined,
    // materialized (own property), not "not loaded"
    const { found: empty } = await seededCustomer([10])
    const noCard = await empty.load('card')

    expect(noCard).toBeUndefined()
    expect(Object.hasOwn(empty, 'card')).toBe(true)
  })

  describe('strict relation access', () => {
    it('reading an unloaded key throws RelationNotLoadedError naming load(), and load() resolves it', async () => {
      setStrictRelationAccess(true)

      const { found } = await seededCustomer([10, 20])

      expect(() => found.orders).toThrow(RelationNotLoadedError)
      expect(() => found.orders).toThrow("instance.load('orders')")

      const loaded = await found.load('orders')

      expect(loaded).toHaveLength(2)

      // The guard no longer fires — the own property shadows it
      expect(() => found.orders).not.toThrow()
      expect(found.orders).toHaveLength(2)
    })

    it('lenient mode: load() works on never-read keys too', async () => {
      const { found } = await seededCustomer([10])

      expect(found.orders).toBeUndefined()

      const loaded = await found.load('orders')

      expect(loaded).toHaveLength(1)
    })
  })

  it('rejects keys that are not declared relationships', async () => {
    const { found } = await seededCustomer([])

    // The facade's own unknown-relationship error (the same one relate()
    // throws) — load() adds no new taxonomy
    await expect(found.load('name')).rejects.toThrow('Unknown relationship "name"')
  })

  it('rejects loading off an instance that was never persisted', async () => {
    const customer = new Customer()
    customer.name = 'unsaved'

    const withMethods = customer as WithMethods<Customer>

    await expect(withMethods.load('orders')).rejects.toThrow(NeodeError)
    await expect(withMethods.load('orders')).rejects.toThrow('no elementId')
  })
})

describe('one-key load reads one row, deterministically (NTS-591)', () => {
  let backend: TestBackend

  let executed: QueryExecutedEvent[]

  const onQuery = (event: QueryExecutedEvent): void => {
    executed.push(event)
  }

  beforeAll(async () => {
    backend = await openBackend()

    setDefaultNeode(backend.neode)
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
    await backend.close()
  })

  /** A saved customer with TWO loyalty cards: one related through the API, one raw — the one-key write path guards its cardinality (NTS-161), the second edge is the nondeterminism the read must survive */
  async function seededTwoCards(): Promise<{
    found: WithMethods<Customer>
    cards: { id: string; code: string }[]
  }> {
    const customer = new Customer()
    customer.name = `customer-${Math.random()}`

    const savedCustomer = (await backend.neode.save(customer)) as WithMethods<Customer>

    const cards: { id: string; code: string }[] = []

    for (const [index, code] of ['card-a', 'card-b'].entries()) {
      const card = new LoyaltyCard()
      card.code = `${code}-${index}`

      const saved = (await backend.neode.save(card)) as WithMethods<LoyaltyCard>

      cards.push({ id: saved.id, code: card.code })

      if (index === 0) {
        await savedCustomer.relateTo(saved, 'card')
      } else {
        await backend.connection.run(
          'MATCH (c:Customer {id: $customerId}), (l:LoyaltyCard {id: $cardId}) CREATE (c)-[:LOYALTY]->(l)',
          { customerId: savedCustomer.id, cardId: saved.id },
        )
      }
    }

    const found = (await backend.neode.find(Customer, savedCustomer.id)) as WithMethods<Customer>

    return { found, cards }
  }

  it('orders by the primary key and reads one row', async () => {
    const { found } = await seededTwoCards()

    executed = []

    const card = await found.load('card')

    expect(card).toBeInstanceOf(LoyaltyCard)

    const traversal = executed[0]?.cypher ?? ''

    expect(traversal).toContain('ORDER BY this_card_node.id')
    expect(traversal).toContain('LIMIT 1')
  })

  it('a one-key with two edges picks the primary-key-smallest deterministically', async () => {
    const { found, cards } = await seededTwoCards()

    const card = await found.load('card')

    expect(card?.id).toBe(cards.map((entry) => entry.id).sort()[0])
  })

  it('the level order stands on a one-key — the primary key does not override it', async () => {
    const { found, cards } = await seededTwoCards()

    executed = []

    const card = await found.load('card', { order: { code: 'DESC' } })

    const newest = [...cards].sort((a, b) => (a.code < b.code ? 1 : -1))[0]

    expect(card?.id).toBe(newest.id)

    const traversal = executed[0]?.cypher ?? ''

    expect(traversal).toContain('ORDER BY this_card_node.code DESC')
    expect(traversal).not.toContain('this_card_node.id')
  })
})
