/**
 * Type-level tests for NTS-156 — the ambient transaction entry
 * `Neode#transaction`. Run with `pnpm test:types`.
 *
 * The stub is inspected through property access only — a call in argument
 * position would be evaluated at runtime (synchronous no-op).
 */
import { describe, expectTypeOf, it } from 'vitest'
import type { AccessMode } from '../../src/driver/types.js'
import type { Neode } from '../../src/neode.service.js'
import type { TransactionOptions } from '../../src/transaction/ambient.js'
import type { TransactionalService } from '../../src/transaction/transactional.service.js'

describe('Neode#transaction (NTS-156)', () => {
  const neode = {
    transaction: () => undefined,
  } as unknown as Neode

  it('the callback result flows to the promise', () => {
    expectTypeOf(neode.transaction(async () => 'value')).toEqualTypeOf<Promise<string>>()
  })

  it('the callback receives a TransactionalService', () => {
    neode.transaction(async (tx) => {
      expectTypeOf(tx).toEqualTypeOf<TransactionalService>()

      return null
    })
  })

  it('options take routing, database and retries', () => {
    const options: TransactionOptions = { routing: 'READ', database: 'neo4j', retries: 1 }

    expectTypeOf(options.routing).toEqualTypeOf<AccessMode | undefined>()
    expectTypeOf(options.database).toEqualTypeOf<string | undefined>()
    expectTypeOf(options.retries).toEqualTypeOf<number | undefined>()
  })
})
