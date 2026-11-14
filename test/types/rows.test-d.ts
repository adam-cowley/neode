import { describe, expectTypeOf, it } from 'vitest'
import type { QueryOutput } from '../../src/index.js'
import { Neode, rows } from '../../src/index.js'
import type { TransformedQueryOutput } from '../../src/index.js'

describe('rows() generics (NTS-632)', () => {
  // The calls evaluate at runtime — the stubs are synchronous no-ops; only
  // the static type of each call is asserted
  const output = undefined as unknown as QueryOutput

  const rowsFn = (() => []) as unknown as typeof rows

  it('defaults to Record<string, unknown> rows', () => {
    expectTypeOf(rowsFn(output)).toEqualTypeOf<Record<string, unknown>[]>()
  })

  it('asserts the row shape from the generic parameter', () => {
    expectTypeOf(rowsFn<{ id: string }>(output)).toEqualTypeOf<{ id: string }[]>()
  })
})

describe('recordTransformer overloads (NTS-632)', () => {
  it('types cypher() rows as the transformer output', () => {
    const neode = {
      cypher: () => undefined,
    } as unknown as Neode

    const result = neode.cypher(
      'RETURN 1',
      {},
      {
        recordTransformer: (row) => ({ id: row.get('id') }),
      },
    )

    expectTypeOf(result).toEqualTypeOf<Promise<TransformedQueryOutput<{ id: unknown }>>>()
  })

  it('keeps the raw QueryOutput contract without a transformer', () => {
    const neode = {
      cypher: () => undefined,
    } as unknown as Neode

    expectTypeOf(neode.cypher('RETURN 1')).toEqualTypeOf<Promise<QueryOutput>>()
  })

  it('types read() rows as the transformer output', () => {
    const neode = {
      read: () => undefined,
    } as unknown as Neode

    const result = neode.read(
      'RETURN 1',
      {},
      {
        recordTransformer: (row) => ({ id: row.get('id') }),
      },
    )

    expectTypeOf(result).toEqualTypeOf<Promise<TransformedQueryOutput<{ id: unknown }>>>()
  })
})
