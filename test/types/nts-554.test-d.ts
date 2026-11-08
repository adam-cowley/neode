/**
 * Type-level tests for NTS-554 — Neode#query(): Builder bound to the
 * instance with .read()/.write() terminals. Run with `pnpm test:types`.
 *
 * Stubs are inspected through property access only — a call in argument
 * position would be evaluated at runtime.
 */
import { describe, expectTypeOf, it } from 'vitest'
import { Builder, BoundBuilder } from '../../src/query/index.js'
import type { QueryOutput } from '../../src/driver/types.js'
import type { Neode } from '../../src/neode.service.js'

describe('Neode#query() bound builder (NTS-554)', () => {
  it('query() returns a BoundBuilder whose terminals run through Neode#read/#write', () => {
    const neode = {} as unknown as Neode
    const bound = {} as unknown as BoundBuilder

    expectTypeOf(neode.query).returns.toEqualTypeOf<BoundBuilder>()
    expectTypeOf(bound.read).returns.toEqualTypeOf<Promise<QueryOutput>>()
    expectTypeOf(bound.write).returns.toEqualTypeOf<Promise<QueryOutput>>()
  })

  it('the plain standalone Builder never gains implicit execution', () => {
    expectTypeOf<'read' extends keyof Builder ? true : false>().toEqualTypeOf<false>()
    expectTypeOf<'write' extends keyof Builder ? true : false>().toEqualTypeOf<false>()
  })
})
