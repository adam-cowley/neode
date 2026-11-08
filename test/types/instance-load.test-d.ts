/**
Type-level tests for instance.load(key) (NTS-558): run with `pnpm
test:types` (vitest typecheck mode) — no runtime assertions here.
*/
import { describe, expectTypeOf, it } from 'vitest'
import type { WithMethods } from '../../src/entity-methods.js'
import { Direction } from '../../src/query/index.js'
import { NodeEntity, OneToMany, OneToOne, Property } from '../../src/decorators/index.js'

@NodeEntity()
class LoadedOrder {
  @Property({ type: 'number' })
  total!: number
}

@NodeEntity()
class LoadedCard {
  @Property({ type: 'string' })
  code!: string
}

@NodeEntity()
class LoadedCustomer {
  @Property({ type: 'string' })
  name!: string

  @OneToMany(() => LoadedOrder, 'PLACED', Direction.OUTGOING)
  orders!: LoadedOrder[]

  @OneToOne({ type: 'LOYALTY', target: () => LoadedCard, direction: Direction.OUTGOING })
  card!: LoadedCard | undefined
}

describe('instance.load typing (NTS-558)', () => {
  // A stub is enough: expectTypeOf checks the TYPES through the cast,
  // while the runtime call only needs the method to exist (the types
  // project executes test bodies)
  const customer = {
    load: () => Promise.resolve(undefined),
  } as unknown as WithMethods<LoadedCustomer>

  it('a many-key resolves to the declared entity array', () => {
    expectTypeOf(customer.load('orders')).toEqualTypeOf<Promise<LoadedOrder[]>>()
  })

  it('a one-key resolves to the declared entity or undefined', () => {
    expectTypeOf(customer.load('card')).toEqualTypeOf<Promise<LoadedCard | undefined>>()
  })

  it('accepts the traversal options', () => {
    expectTypeOf(
      customer.load('orders', { order: { total: 'DESC' }, limit: 20, skip: 10 }),
    ).toEqualTypeOf<Promise<LoadedOrder[]>>()
  })

  it('rejects entity-method names as keys', () => {
    // @ts-expect-error -- save() is a method, not a relationship key
    customer.load('save')
  })
})
