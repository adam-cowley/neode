/**
Type-level tests for instance.related(key) (NTS-497): run with `pnpm
test:types` (vitest typecheck mode) — no runtime assertions here.
*/
import { describe, expectTypeOf, it } from 'vitest'
import type { WithMethods } from '../../src/entity-methods.js'
import type { RelatedScope } from '../../src/services/query/load-relation.service.js'
import { Direction } from '../../src/query/index.js'
import { NodeEntity, OneToMany, OneToOne, Property } from '../../src/decorators/index.js'

@NodeEntity()
class ScopedMovie {
  @Property({ type: 'string' })
  title!: string

  @Property({ type: 'number' })
  year!: number
}

@NodeEntity()
class ScopedCard {
  @Property({ type: 'string' })
  code!: string
}

@NodeEntity()
class ScopedPerson {
  @Property({ type: 'string' })
  name!: string

  @OneToMany(() => ScopedMovie, 'ACTED_IN', Direction.OUTGOING)
  actedIn!: ScopedMovie[]

  @OneToOne({ type: 'FAVORITE', target: () => ScopedCard, direction: Direction.OUTGOING })
  favorite!: ScopedCard | undefined
}

describe('instance.related typing (NTS-497)', () => {
  // A stub is enough: expectTypeOf checks the TYPES through the cast,
  // but the types project EXECUTES test bodies — so the stub must survive
  // being chained (related() -> verbs -> terminals) without doing anything
  const scopeStub: unknown = new Proxy(function stub() {}, {
    apply: () => scopeStub,
    get: () => scopeStub,
  })

  const person = {
    related: () => scopeStub,
  } as unknown as WithMethods<ScopedPerson>

  it('a many-key scopes to the declared entity array item, find() to the array', () => {
    expectTypeOf(person.related('actedIn')).toEqualTypeOf<
      RelatedScope<ScopedMovie, ScopedMovie[]>
    >()
    expectTypeOf(person.related('actedIn').find()).toEqualTypeOf<Promise<ScopedMovie[]>>()
  })

  it('a one-key scopes to the declared entity, find() to entity or undefined', () => {
    expectTypeOf(person.related('favorite')).toEqualTypeOf<
      RelatedScope<ScopedCard, ScopedCard | undefined>
    >()
    expectTypeOf(person.related('favorite').find()).toEqualTypeOf<Promise<ScopedCard | undefined>>()
  })

  it('first() resolves the entity or undefined for either cardinality', () => {
    expectTypeOf(person.related('actedIn').first()).toEqualTypeOf<
      Promise<ScopedMovie | undefined>
    >()
    expectTypeOf(person.related('favorite').first()).toEqualTypeOf<
      Promise<ScopedCard | undefined>
    >()
  })

  it('count() resolves a number', () => {
    expectTypeOf(person.related('actedIn').count()).toEqualTypeOf<Promise<number>>()
  })

  it('the verbs return the same scope for chaining', () => {
    expectTypeOf(person.related('actedIn').where({ year: 1999 })).toEqualTypeOf<
      RelatedScope<ScopedMovie, ScopedMovie[]>
    >()
    expectTypeOf(
      person.related('actedIn').where({ year: 1999 }).orderBy('year').limit(10).skip(5),
    ).toEqualTypeOf<RelatedScope<ScopedMovie, ScopedMovie[]>>()
  })

  it('rejects entity-method names as keys', () => {
    // @ts-expect-error -- save() is a method, not a relationship key
    person.related('save')
  })
})
