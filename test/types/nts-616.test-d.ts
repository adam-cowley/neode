/**
Type-level tests for NTS-616 — the `cypher()` overload surface resolves the
way the issue's contract states, on the facade, the transaction scope and
INeode:

- the default (raw) overload resolves to `Promise<QueryOutput>` — records
  are `QueryRecord[]`, never `unknown[]`
- the hydrate overloads resolve to `Promise<T[]>`

Before the fix the raw overload's options bag subsumed the hydrate
overload's (CypherOptions carries `hydrate`), so hydrate calls resolved to
Promise<QueryOutput>, and on the transaction scope the overloads were
ordered hydrate-first, so a raw call fell into the hydrate overload as
Promise<unknown[]>.

Run with `pnpm test:types`.
*/
import { describe, expectTypeOf, it } from 'vitest'
import type { QueryOutput, QueryRecord } from '../../src/driver/types.js'
import type { Neode } from '../../src/neode.service.js'
import type { INeode } from '../../src/neode.interface.js'
import type { TransactionalService } from '../../src/transaction/transactional.service.js'

class HydrateOrder {
  total?: number
}

describe('NTS-616: cypher() overload return types', () => {
  // The stubs are synchronous no-ops — the calls below are never awaited,
  // only their static types are asserted
  const neode = { cypher: () => undefined } as unknown as Neode
  const tx = { cypher: () => undefined } as unknown as TransactionalService
  const api = { cypher: () => undefined } as unknown as INeode

  it('the default overload resolves to Promise<QueryOutput>', () => {
    expectTypeOf(neode.cypher('RETURN 1')).toEqualTypeOf<Promise<QueryOutput>>()
    expectTypeOf(neode.cypher('RETURN 1', { id: 'x' })).toEqualTypeOf<Promise<QueryOutput>>()
    expectTypeOf(tx.cypher('RETURN 1')).toEqualTypeOf<Promise<QueryOutput>>()
    expectTypeOf(api.cypher('RETURN 1')).toEqualTypeOf<Promise<QueryOutput>>()
  })

  it('records is QueryRecord[] on the default overload', () => {
    // type-only: the helper is never called (expectTypeOf awaits live
    // promises, and the stub returns undefined) — the assertion
    // type-checks overload resolution → QueryOutput → records end to end
    async function unwrap(): Promise<QueryRecord[]> {
      const rows = await neode.cypher('RETURN 1')

      return rows.records
    }

    expectTypeOf<ReturnType<typeof unwrap>>().toEqualTypeOf<Promise<QueryRecord[]>>()
  })

  it('the hydrate overloads still resolve to Promise<T[]>', () => {
    expectTypeOf(neode.cypher('RETURN 1', undefined, { hydrate: HydrateOrder })).toEqualTypeOf<
      Promise<HydrateOrder[]>
    >()
    expectTypeOf(
      tx.cypher('RETURN 1', undefined, { hydrate: HydrateOrder, alias: 'o' }),
    ).toEqualTypeOf<Promise<HydrateOrder[]>>()
    expectTypeOf(
      api.cypher('RETURN 1', undefined, { hydrate: HydrateOrder, alias: 'o' }),
    ).toEqualTypeOf<Promise<HydrateOrder[]>>()
  })
})
