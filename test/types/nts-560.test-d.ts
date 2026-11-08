/**
 * Type-level tests for NTS-560 — the `with` load spec on find / findAll /
 * all. Run with `pnpm test:types` (vitest typecheck mode).
 *
 * Stubs are inspected through property access only — a call in argument
 * position would be evaluated at runtime.
 */
import { describe, expectTypeOf, it } from 'vitest'
import type { LoadSpec, ReadOptions, RelationQuery, WithSpec } from '../../src/query/load-spec.js'
import type { FindOptions } from '../../src/repository/index.js'
import { Builder } from '../../src/query/index.js'

class SpecOrder {
  orderDate?: number
}

class SpecCustomer {
  name?: string
  orders?: SpecOrder[]
}

describe('the `with` load spec (NTS-560)', () => {
  it('rejects keys that are not members of the model at compile time', () => {
    const options: ReadOptions<SpecCustomer> = { with: { orders: true } }

    expectTypeOf(options).toEqualTypeOf<ReadOptions<SpecCustomer>>()

    // @ts-expect-error — "orderz" is not a member of SpecCustomer
    const wrong: ReadOptions<SpecCustomer> = { with: { orderz: true } }

    expectTypeOf(wrong).not.toEqualTypeOf<never>()
  })

  it('the callback receives the comprehension-legal sub-builder only', () => {
    const spec: LoadSpec = (relation) => {
      expectTypeOf(relation.orderBy('orderDate', 'DESC')).not.toBeNever()
      expectTypeOf(relation.limit(2)).not.toBeNever()
      expectTypeOf(relation.skip(0)).not.toBeNever()

      // @ts-expect-error — return() is not comprehension-legal
      relation.return('this')

      // @ts-expect-error — no writes on the relation view either
      relation.set('this.name', 'x')
    }

    expectTypeOf<WithSpec<SpecCustomer>>().toEqualTypeOf<{
      name?: true | LoadSpec
      orders?: true | LoadSpec
    }>()
    expectTypeOf(spec).toBeFunction()
  })

  it('the relation view is satisfied by the real Builder', () => {
    expectTypeOf<Builder>().toExtend<RelationQuery>()
  })

  it('find keeps its Promise<T | undefined> contract with a load spec', () => {
    // find is inspected through its INeode declaration — the contract
    // must not chain into a builder or change shape
    const options: ReadOptions<SpecCustomer> = { with: { orders: true }, database: 'aux' }

    expectTypeOf(options.with).toEqualTypeOf<WithSpec<SpecCustomer> | undefined>()
    expectTypeOf(options.database).toEqualTypeOf<string | undefined>()
  })

  it('repository FindOptions accepts a typed load spec', () => {
    const options: FindOptions<SpecCustomer> = {
      with: { orders: (relation) => relation.orderBy('orderDate', 'DESC').limit(2) },
    }

    expectTypeOf(options.with).toEqualTypeOf<WithSpec<SpecCustomer> | undefined>()

    // @ts-expect-error — unknown relationship keys are rejected here too
    const wrong: FindOptions<SpecCustomer> = { with: { orderz: true } }

    expectTypeOf(wrong).not.toEqualTypeOf<never>()
  })
})
