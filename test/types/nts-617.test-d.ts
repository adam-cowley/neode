/**
Type-level tests for NTS-617 — the `cypher()` options-VARIABLE edge.

A hydrate call with an object literal resolves to `Promise<T[]>` (excess
property checks push the literal to the hydrate overload). A hydrate call
whose options are a pre-built VARIABLE annotated `CypherOptions` matches
the raw overload instead — excess property checks only apply to literals,
and `CypherOptions` is structurally assignable to the raw overload's
`Omit<CypherOptions, 'hydrate'>` — so the call resolves to
`Promise<QueryOutput>` even though the runtime hydrates.

Branding the raw overload's options (`hydrate?: never`) cannot fix this:
under `exactOptionalPropertyTypes` a plain `CypherOptions` variable (with
or without hydrate — the annotation erases the constructor) stops matching
the raw overload, breaking compiling raw calls, and the variable case
still never recovers `Promise<T[]>`. The edge is documented in
docs/api-reference.md instead: build the options as a literal, or keep the
literal type with `satisfies` (a weak-type check then rejects the raw
overload and the hydrate overload matches).

These assertions pin that decided behaviour — if an overload change moves
them, this file is where the edge is re-decided.

Run with `pnpm test:types`.
*/
import { describe, expectTypeOf, it } from 'vitest'
import type { CypherOptions, QueryOutput } from '../../src/driver/types.js'
import type { Neode } from '../../src/neode.service.js'
import type { TransactionalService } from '../../src/transaction/transactional.service.js'

class HydrateOrder {
  total?: number
}

describe('NTS-617: cypher() with a pre-built options variable', () => {
  // The stubs are synchronous no-ops — the calls below are never awaited,
  // only their static types are asserted
  const neode = { cypher: () => undefined } as unknown as Neode
  const tx = { cypher: () => undefined } as unknown as TransactionalService

  it('a CypherOptions-annotated variable carrying hydrate resolves to Promise<QueryOutput> (documented edge)', () => {
    const options: CypherOptions = { hydrate: HydrateOrder }

    expectTypeOf(neode.cypher('RETURN 1', undefined, options)).toEqualTypeOf<Promise<QueryOutput>>()
    expectTypeOf(tx.cypher('RETURN 1', undefined, options)).toEqualTypeOf<Promise<QueryOutput>>()
  })

  it('a CypherOptions-annotated variable without hydrate still resolves to Promise<QueryOutput>', () => {
    const options: CypherOptions = { routing: 'READ' }

    expectTypeOf(neode.cypher('RETURN 1', undefined, options)).toEqualTypeOf<Promise<QueryOutput>>()
    expectTypeOf(tx.cypher('RETURN 1', undefined, options)).toEqualTypeOf<Promise<QueryOutput>>()
  })

  it('satisfies keeps the literal type, so a hydrate-bearing options variable resolves to Promise<T[]>', () => {
    const options = { hydrate: HydrateOrder } satisfies CypherOptions

    expectTypeOf(neode.cypher('RETURN 1', undefined, options)).toEqualTypeOf<
      Promise<HydrateOrder[]>
    >()
    expectTypeOf(tx.cypher('RETURN 1', undefined, options)).toEqualTypeOf<Promise<HydrateOrder[]>>()
  })
})
