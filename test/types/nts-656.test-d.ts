/**
 * Type-level tests for NTS-656 — the whereProps / whereInRefs surface:
 * the operator parameter narrows to the comparison operators (a typo'd
 * operator is a compile error at the call site) and both arguments of
 * whereInRefs are references (strings), not values. Run with
 * `pnpm test:types` (vitest typecheck mode).
 */
import { describe, expectTypeOf, it } from 'vitest'
import { NeodeError } from '../../src/errors/index.js'
import { Builder } from '../../src/query/index.js'

describe('Builder.whereProps typing (NTS-656)', () => {
  it('accepts the comparison operators and reference strings', () => {
    const builder = new Builder()

    expectTypeOf(builder.whereProps).toBeCallableWith('other', '<>', 'c')
    expectTypeOf(builder.whereProps).toBeCallableWith('p.unitsInStock', '<=', 'p.reorderLevel')
    expectTypeOf(builder.whereProps).toBeCallableWith('a', 'IN', 'mine')
    expectTypeOf(builder.whereInRefs).toBeCallableWith('p2', 'mine')
  })

  it('rejects a typo operator at the call site', () => {
    const builder = new Builder()

    // @ts-expect-error — '!=' is not a comparison operator
    expect(() => builder.whereProps('other', '!=', 'c')).toThrow(NeodeError)
    // @ts-expect-error — 'IS NULL' is unary; use whereNull()
    expect(() => builder.whereProps('secondOrder', 'IS NULL', '')).toThrow(NeodeError)
  })

  it('rejects non-reference arguments', () => {
    const builder = new Builder()

    // @ts-expect-error — whereInRefs takes a reference, not a value list
    expect(() => builder.whereInRefs('p2', ['a', 'b'])).toThrow(NeodeError)
    // @ts-expect-error — both whereProps sides are references, not values
    expect(() => builder.whereProps('p.unitsInStock', '<=', 100)).toThrow(NeodeError)
  })
})
