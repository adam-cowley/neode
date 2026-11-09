/**
 * Type-level tests for NTS-154 — the type-level model map and the narrowed
 * per-query `with()` return. Run with `pnpm test:types` (vitest typecheck
 * mode; test bodies execute, so the facade is a working stub).
 */
import { describe, expectTypeOf, it } from 'vitest'
import { NodeEntity, OneToMany, OneToOne, Property } from '../../src/decorators/index.js'
import { Direction } from '../../src/query/index.js'
import type { Neode } from '../../src/neode.service.js'
import type { QueryLoadLevel } from '../../src/query/load-spec.js'

@NodeEntity()
class NTS154Toy {
  @Property({ type: 'string' })
  name!: string
}

@NodeEntity()
class NTS154Pet {
  @Property({ type: 'string' })
  kind!: string

  @OneToMany(() => NTS154Toy, 'FOR', Direction.OUTGOING)
  toys?: NTS154Toy[]

  // the type-level model map (NTS-154): `toys` is a relationship
  declare static readonly neodeRelationships: { toys: true }
}

@NodeEntity()
class NTS154Card {
  @Property({ type: 'string' })
  code!: string
}

@NodeEntity()
class NTS154Person {
  @Property({ type: 'string' })
  name!: string

  @OneToMany(() => NTS154Pet, 'HAS_PET', Direction.OUTGOING)
  pets?: NTS154Pet[]

  @OneToOne({ type: 'HAS_CARD', target: () => NTS154Card, direction: Direction.OUTGOING })
  card?: NTS154Card

  // the type-level model map (NTS-154): pets and card are relationships —
  // every other field (name) is a property and rejected by `with`
  declare static readonly neodeRelationships: { pets: true; card: true }
}

// a phantom-less model: the fallback key domain (declared object/array
// field types) drives `with`
@NodeEntity()
class NTS154Movie {
  @Property({ type: 'string' })
  title!: string
}

@NodeEntity()
class NTS154Studio {
  @OneToMany(() => NTS154Movie, 'PRODUCED', Direction.OUTGOING)
  movies?: NTS154Movie[]
}

// a working stub — the typecheck project executes test bodies
const neode = {
  find: async () => undefined,
  all: async () => [],
} as unknown as Neode

describe('the type-level model map + narrowed `with` returns (NTS-154)', () => {
  it('the acceptance example: find narrows to Person & { pets: (Pet & { toys: Toy[] })[] }', async () => {
    const user = await neode.find(NTS154Person, 'id-1', {
      with: { pets: { toys: true } },
    })

    expectTypeOf(user).toEqualTypeOf<
      (NTS154Person & { pets: (NTS154Pet & { toys: NTS154Toy[] })[] }) | undefined
    >()

    const toys: NTS154Toy[] | undefined = user?.pets?.[0]?.toys

    expectTypeOf(toys).not.toBeNever()
  })

  it('a one-key relationship loads single-or-undefined, per the runtime hydration contract', async () => {
    const user = await neode.find(NTS154Person, 'id-2', { with: { card: true } })

    expectTypeOf(user?.card).toEqualTypeOf<NTS154Card | undefined>()
  })

  it('a plain `true` request narrows to the declared field type', async () => {
    const user = await neode.find(NTS154Person, 'id-3', { with: { pets: true } })

    expectTypeOf(user).toEqualTypeOf<(NTS154Person & { pets: NTS154Pet[] }) | undefined>()
  })

  it('a LoadSpec callback still narrows (one level, NTS-560 shape)', async () => {
    const user = await neode.find(NTS154Person, 'id-4', {
      with: { pets: (relation) => relation.limit(2) },
    })

    expectTypeOf(user).toEqualTypeOf<(NTS154Person & { pets: NTS154Pet[] }) | undefined>()
  })

  it('a nested level may carry the level trim (order / skip / limit) without changing the shape', async () => {
    const user = await neode.find(NTS154Person, 'id-5', {
      with: { pets: { toys: { limit: 1 } } },
    })

    expectTypeOf(user).toEqualTypeOf<
      (NTS154Person & { pets: (NTS154Pet & { toys: NTS154Toy[] })[] }) | undefined
    >()
  })

  it('a level may mix the trim keys and nested relationship keys in one object', async () => {
    const user = await neode.find(NTS154Person, 'id-5b', {
      with: { pets: { limit: 3, toys: true } },
    })

    expectTypeOf(user).toEqualTypeOf<
      (NTS154Person & { pets: (NTS154Pet & { toys: NTS154Toy[] })[] }) | undefined
    >()
  })

  it('all() narrows the same way', async () => {
    const users = await neode.all(NTS154Person, {}, undefined, undefined, undefined, undefined, {
      with: { pets: true },
    })

    expectTypeOf(users).toEqualTypeOf<(NTS154Person & { pets: NTS154Pet[] })[]>()
  })

  it('a wrong root key is a type error on a map-declared model', async () => {
    // @ts-expect-error — "orderz" is not a declared relationship of NTS154Person
    await neode.find(NTS154Person, 'id-6', { with: { orderz: true } })
  })

  it('a wrong nested key is a type error', async () => {
    // @ts-expect-error — "wishlist" is not a member of NTS154Pet
    await neode.find(NTS154Person, 'id-7', { with: { pets: { wishlist: true } } })
  })

  it('a property key falls through to the legacy overload — no narrowing; the runtime rejects it', async () => {
    // ceiling (docs/decisions/0002): the legacy ReadOptions overload (the
    // INeode contract) cannot exclude property keys — the narrowed
    // overload is tried first, this falls through, and the runtime
    // validation throws the descriptive NeodeError
    const user = await neode.find(NTS154Person, 'id-8', { with: { name: true } })

    expectTypeOf(user).toEqualTypeOf<NTS154Person | undefined>()
  })

  it('without `with`, the return contract is unchanged', async () => {
    const user = await neode.find(NTS154Person, 'id-9')

    expectTypeOf(user).toEqualTypeOf<NTS154Person | undefined>()
  })

  it('the phantom static never pollutes the instance type', () => {
    expectTypeOf<keyof NTS154Person>().toEqualTypeOf<'name' | 'pets' | 'card'>()
  })

  it('a phantom-less model falls back to the declared object/array field keys', async () => {
    const studios = await neode.all(NTS154Studio, {}, undefined, undefined, undefined, undefined, {
      with: { movies: true },
    })

    expectTypeOf(studios).toEqualTypeOf<(NTS154Studio & { movies: NTS154Movie[] })[]>()
  })

  it('a plain all() claims no loads (the narrowed overload requires the spec)', async () => {
    const studios = await neode.all(NTS154Studio)

    expectTypeOf(studios).toEqualTypeOf<NTS154Studio[]>()
  })

  it('unknown keys are rejected at the call level on the fallback tier too', async () => {
    await neode.all(
      NTS154Studio,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      // @ts-expect-error — "notAField" is not a member of NTS154Studio
      { with: { notAField: true } },
    )
  })

  it('a property key falls through to the legacy overload on the fallback tier — no narrowing', async () => {
    // ceiling (docs/decisions/0002): "title" IS a key of NTS154Movie, so
    // the legacy keyof-T overload accepts it — no narrowing claim, and the
    // runtime validation throws the descriptive NeodeError
    const movies = await neode.all(NTS154Movie, {}, undefined, undefined, undefined, undefined, {
      with: { title: true },
    })

    expectTypeOf(movies).toEqualTypeOf<NTS154Movie[]>()
  })

  it('on a concrete annotation the fallback tier does reject property keys', () => {
    const level: QueryLoadLevel<NTS154Studio> = { movies: true }

    // @ts-expect-error — "title" is a string property, never a relationship
    const wrong: QueryLoadLevel<NTS154Studio> = { title: true }

    expectTypeOf(level).not.toBeNever()
    expectTypeOf(wrong).not.toBeNever()
  })
})
