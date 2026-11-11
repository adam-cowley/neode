/**
 * Type-level tests for NTS-646 — the typed where-filter bag keyed to the
 * model's declared properties: equality values and operator objects
 * type-check against the declared keys, relationship keys take nested
 * bags, and unknown keys / unknown operators / value mismatches are
 * compile errors. Run with `pnpm test:types` (vitest typecheck mode; test
 * bodies execute, so the facade is a working stub).
 */
import { describe, expectTypeOf, it } from 'vitest'
import { NodeEntity, OneToMany, OneToOne, Property } from '../../src/decorators/index.js'
import { Direction } from '../../src/query/index.js'
import type { Neode } from '../../src/neode.service.js'
import type { INeode } from '../../src/neode.interface.js'
import type { Newable } from '../../src/meta/newable.js'
import type { TransactionalService } from '../../src/transaction/transactional.service.js'
import { Repository } from '../../src/repository/index.js'

@NodeEntity()
class NTS646Toy {
  @Property({ type: 'string' })
  name!: string
}

@NodeEntity()
class NTS646Pet {
  @Property({ type: 'string' })
  kind!: string

  @OneToMany(() => NTS646Toy, 'FOR', Direction.OUTGOING)
  toys?: NTS646Toy[]

  declare static readonly neodeRelationships: { toys: true }
}

@NodeEntity()
class NTS646Card {
  @Property({ type: 'string' })
  code!: string
}

@NodeEntity()
class NTS646Person {
  @Property({ type: 'string' })
  name!: string

  @Property({ type: 'number' })
  age!: number

  @OneToMany(() => NTS646Pet, 'HAS_PET', Direction.OUTGOING)
  pets?: NTS646Pet[]

  @OneToOne({ type: 'HAS_CARD', target: () => NTS646Card, direction: Direction.OUTGOING })
  card?: NTS646Card

  // a method key: never a filter key (NTS-646 key domain)
  greet(): string {
    return this.name
  }

  // the type-level model map (NTS-154): pets and card are relationships —
  // every other field (name, age) is a property
  declare static readonly neodeRelationships: { pets: true; card: true }
}

// a phantom-less model: the fallback key domain (declared object/array
// field types) drives the relationship keys
@NodeEntity()
class NTS646Movie {
  @Property({ type: 'string' })
  title!: string
}

@NodeEntity()
class NTS646Studio {
  @Property({ type: 'string' })
  city!: string

  @OneToMany(() => NTS646Movie, 'PRODUCED', Direction.OUTGOING)
  movies?: NTS646Movie[]
}

// a working stub — the typecheck project executes test bodies, and every
// assertion here is type-level (expectTypeOf erases; the stub answers the
// executed calls)
const repositoryStub = {
  find: async () => undefined,
  all: async () => [],
  // count() reads a count() row; the row reads get an empty record set
  readCypher: async (query: string) =>
    query.includes('count(')
      ? { records: [{ get: () => undefined }], summary: {} }
      : { records: [], summary: {} },
} as unknown as INeode

const neode = {
  getRepository: (entity: Newable) => new Repository(repositoryStub, entity),
  get: async () => [],
  getFirst: async () => undefined,
  first: async () => undefined,
  all: async () => [],
  paginate: async () => ({ items: [], total: 0, page: 1, limit: 10, totalPages: 0 }),
  findManyAndCount: async () => ({ items: [], total: 0 }),
} as unknown as Neode

const tx = {
  get: async () => [],
} as unknown as TransactionalService

describe('the typed where-filter bag (NTS-646)', () => {
  it('the acceptance example: equality and operator objects on the facade get()', async () => {
    const people = await neode.get(NTS646Person, { name: 'Adam', age: { gte: 18 } })

    expectTypeOf(people).toEqualTypeOf<NTS646Person[]>()
  })

  it('every operator of the set type-checks against a matching property', async () => {
    await neode.get(NTS646Person, {
      name: {
        eq: 'Adam',
        neq: 'Bob',
        contains: 'da',
        startsWith: 'Ad',
        endsWith: 'am',
        in: ['Adam', 'Ada'],
        null: false,
      },
      age: { gt: 3, gte: 3, lt: 9, lte: 9, in: [1, 2], eq: 4, neq: 5, null: true },
    })
  })

  it('relationship keys take nested filter bags', async () => {
    await neode.get(NTS646Person, { pets: { kind: { startsWith: 'ca' } } })

    await neode.get(NTS646Person, { card: { code: { eq: 'X1' } } })
  })

  it('all() takes the same bag beside the with spec', async () => {
    const people = await neode.all(NTS646Person, { age: { gte: 18 } })

    expectTypeOf(people).toEqualTypeOf<NTS646Person[]>()

    const loaded = await neode.all(
      NTS646Person,
      { age: { gte: 18 } },
      undefined,
      undefined,
      undefined,
      undefined,
      { with: { pets: true } },
    )

    expectTypeOf(loaded).toEqualTypeOf<(NTS646Person & { pets: NTS646Pet[] })[]>()
  })

  it('paginate / findManyAndCount / first take the bag', () => {
    expectTypeOf(
      neode.paginate(NTS646Person, { age: { gte: 1 } }, { page: 1, limit: 10 }),
    ).toEqualTypeOf<
      Promise<{
        items: NTS646Person[]
        total: number
        page: number
        limit: number
        totalPages: number
      }>
    >()

    expectTypeOf(neode.findManyAndCount(NTS646Person, { name: 'Adam' })).toEqualTypeOf<
      Promise<{ items: NTS646Person[]; total: number }>
    >()

    expectTypeOf(neode.first(NTS646Person, { age: { gte: 1 } })).toEqualTypeOf<
      Promise<NTS646Person | undefined>
    >()
  })

  it('the TransactionalService mirror takes the same bag', async () => {
    const people = await tx.get(NTS646Person, { age: { gte: 18 } })

    expectTypeOf(people).toEqualTypeOf<NTS646Person[]>()
  })

  it('the Repository bags take operator objects', async () => {
    const people = await neode.getRepository(NTS646Person).findAll({ age: { gte: 18 } })

    expectTypeOf(people).toEqualTypeOf<NTS646Person[]>()

    await neode.getRepository(NTS646Person).where({ name: { contains: 'a' } })
    await neode.getRepository(NTS646Person).count({ age: { lte: 9 } })
    await neode.getRepository(NTS646Person).findBy({ name: { eq: 'Adam' } })
  })

  it('a phantom-less model falls back to the declared field-key domain', async () => {
    const studios = await neode.all(NTS646Studio, {
      city: { eq: 'Berlin' },
      movies: { title: { startsWith: 'The' } },
    })

    expectTypeOf(studios).toEqualTypeOf<NTS646Studio[]>()
  })

  it('a typo key is a compile error', async () => {
    await neode.get(
      NTS646Person,
      // @ts-expect-error — "nme" is not a declared property of NTS646Person
      { nme: 'Adam' },
    )
  })

  it('a relationship key used as a value is a compile error', async () => {
    await neode.get(
      NTS646Person,
      // @ts-expect-error — "pets" is a relationship, not a filterable value
      { pets: 'Dog' },
    )
  })

  it('an unknown operator key inside an operator object is a compile error', async () => {
    await neode.get(
      NTS646Person,
      // @ts-expect-error — "gte_" is not an operator of the set
      { age: { gte_: 3 } },
    )
  })

  it('a value-type mismatch inside an operator object is a compile error', async () => {
    await neode.get(
      NTS646Person,
      // @ts-expect-error — gte on a number property does not take a string
      { age: { gte: 'x' } },
    )
  })

  it('the string operators are rejected on non-string properties', async () => {
    await neode.get(
      NTS646Person,
      // @ts-expect-error — contains on a number property is never
      { age: { contains: 'x' } },
    )
  })

  it('a method key is a compile error', async () => {
    await neode.get(
      NTS646Person,
      // @ts-expect-error — a method key is not a filter key
      { greet: true },
    )
  })

  it('equality stays the dominant form: the plain bag is unchanged', async () => {
    await neode.get(NTS646Person, { name: 'Adam', age: 18 })
  })
})
