/**
Type-level tests for the per-instance load spec (NTS-498): run with `pnpm
test:types` (vitest typecheck mode) — no runtime assertions here.
*/
import { describe, expectTypeOf, it } from 'vitest'
import type { WithMethods } from '../../src/entity-methods.js'
import { Direction } from '../../src/query/index.js'
import { NodeEntity, OneToMany, OneToOne, Property } from '../../src/decorators/index.js'

@NodeEntity()
class SpecOrder {
  @Property({ type: 'number' })
  total!: number

  @OneToMany(() => SpecLine, 'CONTAINS', Direction.OUTGOING)
  lines!: SpecLine[]
}

@NodeEntity()
class SpecLine {
  @Property({ type: 'number' })
  position!: number
}

@NodeEntity()
class SpecCard {
  @Property({ type: 'string' })
  code!: string
}

@NodeEntity()
class SpecCustomer {
  @Property({ type: 'string' })
  name!: string

  @OneToMany(() => SpecOrder, 'PLACED', Direction.OUTGOING)
  orders!: SpecOrder[]

  @OneToOne({ type: 'LOYALTY', target: () => SpecCard, direction: Direction.OUTGOING })
  card!: SpecCard | undefined
}

describe('instance.load(spec) typing (NTS-498)', () => {
  // A stub is enough: expectTypeOf checks the TYPES through the cast,
  // while the runtime call only needs the method to exist (the types
  // project executes test bodies)
  const customer = {
    load: () => Promise.resolve(undefined),
  } as unknown as WithMethods<SpecCustomer>

  it('the spec resolves to void — values materialize as own properties', () => {
    expectTypeOf(customer.load({ orders: true })).toEqualTypeOf<Promise<void>>()
  })

  it('accepts several root keys with per-level options', () => {
    expectTypeOf(
      customer.load({
        orders: { order: { total: 'DESC' }, limit: 3 },
        card: true,
      }),
    ).toEqualTypeOf<Promise<void>>()
  })

  it('a nested level checks its keys against the declared target type', () => {
    expectTypeOf(
      customer.load({
        orders: {
          lines: { order: { position: 'DESC' }, limit: 2 },
        },
      }),
    ).toEqualTypeOf<Promise<void>>()
  })

  it('rejects an undeclared key at the root', () => {
    // @ts-expect-error -- wishlist is not a declared key of SpecCustomer
    customer.load({
      wishlist: true,
    })
  })

  it('rejects an undeclared key at depth', () => {
    // @ts-expect-error -- wishlist is not a declared key of SpecOrder
    customer.load({
      orders: {
        wishlist: true,
      },
    })
  })

  it('rejects entity-method names as spec keys', () => {
    // @ts-expect-error -- save() is a method, not a relationship key
    customer.load({
      save: true,
    })
  })
})
