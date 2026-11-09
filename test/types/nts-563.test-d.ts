/**
 * Type-level tests for NTS-563 — the constructor-generic Repository: the
 * `with` load spec of find / findAll is map-checked against the model's
 * `neodeRelationships` phantom static and the returns narrow, the same
 * contract the facade paths got in NTS-154. Run with `pnpm test:types`
 * (vitest typecheck mode; test bodies execute, so the facade is a working
 * stub).
 */
import { describe, expectTypeOf, it } from 'vitest'
import { NodeEntity, OneToMany, OneToOne, Property } from '../../src/decorators/index.js'
import { Direction } from '../../src/query/index.js'
import type { Neode } from '../../src/neode.service.js'
import type { INeode } from '../../src/neode.interface.js'
import type { Newable } from '../../src/meta/newable.js'
import { Repository } from '../../src/repository/index.js'

@NodeEntity()
class NTS563Toy {
  @Property({ type: 'string' })
  name!: string
}

@NodeEntity()
class NTS563Pet {
  @Property({ type: 'string' })
  kind!: string

  @OneToMany(() => NTS563Toy, 'FOR', Direction.OUTGOING)
  toys?: NTS563Toy[]

  declare static readonly neodeRelationships: { toys: true }
}

@NodeEntity()
class NTS563Card {
  @Property({ type: 'string' })
  code!: string
}

@NodeEntity()
class NTS563Person {
  @Property({ type: 'string' })
  name!: string

  @OneToMany(() => NTS563Pet, 'HAS_PET', Direction.OUTGOING)
  pets?: NTS563Pet[]

  @OneToOne({ type: 'HAS_CARD', target: () => NTS563Card, direction: Direction.OUTGOING })
  card?: NTS563Card

  // the type-level model map (NTS-154): pets and card are relationships —
  // every other field (name) is a property and rejected by `with`
  declare static readonly neodeRelationships: { pets: true; card: true }
}

// a phantom-less model: the fallback key domain (declared object/array
// field types) drives `with`
@NodeEntity()
class NTS563Movie {
  @Property({ type: 'string' })
  title!: string
}

@NodeEntity()
class NTS563Studio {
  @OneToMany(() => NTS563Movie, 'PRODUCED', Direction.OUTGOING)
  movies?: NTS563Movie[]
}

// a working stub — the typecheck project executes test bodies, and the
// repository constructor resolves the (registered) model at runtime
const stub = {
  find: async () => undefined,
  all: async () => [],
  readCypher: async () => ({ records: [] }),
} as unknown as INeode

const neode = {
  getRepository: (entity: Newable) => new Repository(stub, entity),
} as unknown as Neode

describe('the constructor-generic Repository (NTS-563)', () => {
  it('the acceptance example: findAll narrows to Person & { pets: (Pet & { toys: Toy[] })[] }', async () => {
    const customers = await neode.getRepository(NTS563Person).findAll(
      {},
      {
        with: { pets: { toys: true } },
      },
    )

    expectTypeOf(customers).toEqualTypeOf<
      (NTS563Person & { pets: (NTS563Pet & { toys: NTS563Toy[] })[] })[]
    >()

    const toys: NTS563Toy[] | undefined = customers[0]?.pets?.[0]?.toys

    expectTypeOf(toys).not.toBeNever()
  })

  it('find narrows the same way', async () => {
    const customer = await neode.getRepository(NTS563Person).find('id-1', {
      with: { pets: { toys: true } },
    })

    expectTypeOf(customer).toEqualTypeOf<
      (NTS563Person & { pets: (NTS563Pet & { toys: NTS563Toy[] })[] }) | undefined
    >()
  })

  it('a one-key relationship loads single-or-undefined, per the runtime hydration contract', async () => {
    const customer = await neode.getRepository(NTS563Person).find('id-2', { with: { card: true } })

    expectTypeOf(customer?.card).toEqualTypeOf<NTS563Card | undefined>()
  })

  it('a LoadSpec callback still narrows (NTS-560 shape)', async () => {
    const customers = await neode.getRepository(NTS563Person).findAll(
      {},
      {
        with: { pets: (relation) => relation.limit(2) },
      },
    )

    expectTypeOf(customers).toEqualTypeOf<(NTS563Person & { pets: NTS563Pet[] })[]>()
  })

  it('a spec level may mix the trim keys and nested relationship keys in one object', async () => {
    const customers = await neode.getRepository(NTS563Person).findAll(
      {},
      {
        with: { pets: { limit: 3, toys: true } },
      },
    )

    expectTypeOf(customers).toEqualTypeOf<
      (NTS563Person & { pets: (NTS563Pet & { toys: NTS563Toy[] })[] })[]
    >()
  })

  it('order / limit / skip and withoutFilters compose with the spec (NTS-162)', async () => {
    const customers = await neode.getRepository(NTS563Person).findAll(
      {},
      {
        order: 'name',
        limit: 10,
        skip: 5,
        withoutFilters: ['tenancy'],
        with: { pets: true },
      },
    )

    expectTypeOf(customers).toEqualTypeOf<(NTS563Person & { pets: NTS563Pet[] })[]>()
  })

  it('a wrong root key is a type error on a map-declared model', async () => {
    await neode.getRepository(NTS563Person).findAll(
      {},
      // @ts-expect-error — "orderz" is not a declared relationship of NTS563Person
      { with: { orderz: true } },
    )
  })

  it('a wrong nested key is a type error', async () => {
    await neode.getRepository(NTS563Person).findAll(
      {},
      // @ts-expect-error — "wishlist" is not a member of NTS563Pet
      { with: { pets: { wishlist: true } } },
    )
  })

  it('a PROPERTY key is a type error here — no legacy-overload fallthrough', async () => {
    // the Repository's options are map-checked on both tiers (the facade's
    // legacy overloads let property keys through to the runtime — the
    // ceiling docs/decisions/0002 records); the Repository surface never
    // had the loose overload, so the compile-time rejection is total
    await neode.getRepository(NTS563Person).findAll(
      {},
      // @ts-expect-error — "name" is a property, never a relationship
      { with: { name: true } },
    )
  })

  it('without `with`, the return contract is unchanged', async () => {
    const customers = await neode.getRepository(NTS563Person).findAll()

    expectTypeOf(customers).toEqualTypeOf<NTS563Person[]>()

    const customer = await neode.getRepository(NTS563Person).find('id-3')

    expectTypeOf(customer).toEqualTypeOf<NTS563Person | undefined>()
  })

  it('a phantom-less model falls back to the declared object/array field keys', async () => {
    const studios = await neode.getRepository(NTS563Studio).findAll({}, { with: { movies: true } })

    expectTypeOf(studios).toEqualTypeOf<(NTS563Studio & { movies: NTS563Movie[] })[]>()
  })

  it('a plain-annotated Repository<Entity> keeps the fallback tier (custom-repository compat)', () => {
    const plain: Repository<NTS563Person> = neode.getRepository(NTS563Person)

    expectTypeOf(plain.findAll({}, { with: { pets: true } })).toEqualTypeOf<
      Promise<(NTS563Person & { pets: NTS563Pet[] })[]>
    >()
  })
})
