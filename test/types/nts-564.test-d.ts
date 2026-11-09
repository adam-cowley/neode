/**
 * Type-level tests for NTS-564 — the toJson relationship serialisation
 * options on the standalone function and the instance-method surface. Run
 * with `pnpm test:types` (vitest typecheck mode; test bodies execute, so
 * the entity is a real registered instance and the malformed-option calls
 * sit in never-invoked thunks).
 */
import { describe, expectTypeOf, it } from 'vitest'
import { toJson, type ToJsonOptions } from '../../src/serialise.js'
import { applyEntityMethods, type WithMethods } from '../../src/entity-methods.js'
import { NodeEntity, OneToMany, String, Uuid, InternalId } from '../../src/decorators/index.js'
import { Direction } from '../../src/query/index.js'

@NodeEntity()
class NTS564Landmark {
  @InternalId()
  _id!: string

  @Uuid({ primary: true })
  id!: string

  @String()
  name!: string

  @OneToMany(() => NTS564Landmark, 'NEARBY', Direction.OUTGOING)
  nearby?: NTS564Landmark[]
}

// test bodies execute — wire the instance methods and use a real instance
applyEntityMethods(NTS564Landmark)
const landmark = new NTS564Landmark() as WithMethods<NTS564Landmark>

describe('toJson relationship serialisation options (NTS-564)', () => {
  it('the options shape is accepted on both surfaces', () => {
    expectTypeOf(toJson(landmark)).toEqualTypeOf<Record<string, unknown>>()
    expectTypeOf(toJson(landmark, undefined)).toEqualTypeOf<Record<string, unknown>>()
    expectTypeOf(toJson(landmark, {})).toEqualTypeOf<Record<string, unknown>>()
    expectTypeOf(toJson(landmark, { relationships: { include: ['nearby'] } })).toEqualTypeOf<
      Record<string, unknown>
    >()
    expectTypeOf(
      toJson(landmark, { relationships: { exclude: ['nearby'], depth: 2 } }),
    ).toEqualTypeOf<Record<string, unknown>>()

    expectTypeOf(landmark.toJson()).toEqualTypeOf<Record<string, unknown>>()
    expectTypeOf(landmark.toJson({ relationships: { depth: 1 } })).toEqualTypeOf<
      Record<string, unknown>
    >()
    expectTypeOf(landmark.toJson).parameter(0).toEqualTypeOf<ToJsonOptions | undefined>()
  })

  it('rejects malformed options at compile time', () => {
    const stringDepth = () =>
      // @ts-expect-error — depth must be a number, not a string
      toJson(landmark, { relationships: { depth: '1' } })
    const objectInclude = () =>
      // @ts-expect-error — include is a list of keys, not a record
      toJson(landmark, { relationships: { include: { nearby: true } } })
    const unknownKey = () =>
      // @ts-expect-error — unknown option keys are rejected
      toJson(landmark, { relationshipz: {} })

    expectTypeOf<ReturnType<typeof stringDepth>>().toEqualTypeOf<Record<string, unknown>>()
    expectTypeOf<ReturnType<typeof objectInclude>>().toEqualTypeOf<Record<string, unknown>>()
    expectTypeOf<ReturnType<typeof unknownKey>>().toEqualTypeOf<Record<string, unknown>>()
  })
})
