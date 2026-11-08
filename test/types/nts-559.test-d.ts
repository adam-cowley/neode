/**
 * Type-level tests for NTS-559 — the hydrate overloads on Neode#read /
 * Neode#write (facade + transaction scope). Run with `pnpm test:types`.
 *
 * Stubs are inspected through property access only — a call in argument
 * position would be evaluated at runtime.
 */
import { describe, expectTypeOf, it } from 'vitest'
import { Builder } from '../../src/query/index.js'
import type { QueryOutput } from '../../src/driver/types.js'
import type { Neode } from '../../src/neode.service.js'
import type { TransactionalService } from '../../src/transaction/transactional.service.js'

class HydrateOrder {
  total?: number
}

describe('Neode#read / Neode#write hydrate overloads (NTS-559)', () => {
  // The calls evaluate at runtime — the stubs are synchronous no-ops; only
  // the static type of each call is asserted
  const neode = {
    read: () => undefined,
    write: () => undefined,
  } as unknown as Neode

  const tx = {
    read: () => undefined,
    write: () => undefined,
  } as unknown as TransactionalService

  it('the hydrate option returns entities of the given class', () => {
    const builder = new Builder()

    expectTypeOf(neode.read(builder, {}, { hydrate: HydrateOrder })).toEqualTypeOf<
      Promise<HydrateOrder[]>
    >()
    // the two-argument form — the options object in the parameters position
    expectTypeOf(neode.read(builder, { hydrate: HydrateOrder })).toEqualTypeOf<
      Promise<HydrateOrder[]>
    >()
    expectTypeOf(neode.write(builder, { hydrate: HydrateOrder, alias: 'o' })).toEqualTypeOf<
      Promise<HydrateOrder[]>
    >()
    expectTypeOf(
      neode.read(builder, {}, { hydrate: HydrateOrder, alias: 'o', database: 'aux' }),
    ).toEqualTypeOf<Promise<HydrateOrder[]>>()
    expectTypeOf(
      neode.read('MATCH (o:Order) RETURN o', undefined, { hydrate: HydrateOrder, alias: 'o' }),
    ).toEqualTypeOf<Promise<HydrateOrder[]>>()
    expectTypeOf(neode.write(builder, {}, { hydrate: HydrateOrder })).toEqualTypeOf<
      Promise<HydrateOrder[]>
    >()
  })

  it('the NTS-553 positional shape still resolves to the raw output', () => {
    const builder = new Builder()

    expectTypeOf(neode.read(builder)).toEqualTypeOf<Promise<QueryOutput>>()
    expectTypeOf(neode.read(builder, { id: 'x' }, 'aux')).toEqualTypeOf<Promise<QueryOutput>>()
    expectTypeOf(neode.write(builder, { id: 'x' }, 'aux')).toEqualTypeOf<Promise<QueryOutput>>()
  })

  it('mirrored on the transaction scope', () => {
    const builder = new Builder()

    expectTypeOf(tx.read(builder, undefined, { hydrate: HydrateOrder })).toEqualTypeOf<
      Promise<HydrateOrder[]>
    >()
    expectTypeOf(tx.read(builder, { hydrate: HydrateOrder, alias: 'o' })).toEqualTypeOf<
      Promise<HydrateOrder[]>
    >()
    expectTypeOf(tx.write(builder, undefined, { hydrate: HydrateOrder, alias: 'o' })).toEqualTypeOf<
      Promise<HydrateOrder[]>
    >()
    expectTypeOf(tx.read(builder)).toEqualTypeOf<Promise<QueryOutput>>()
  })
})
