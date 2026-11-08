/**
 * Type-level tests for the public API's inference (Phase 4): run with
 * `pnpm test:types` (vitest typecheck mode) — no runtime assertions here.
 */
import { describe, expectTypeOf, it } from 'vitest'
import { defineModel, getModelByName } from '../../src/meta/map-schema.js'
import { hydrate } from '../../src/hydrate.js'
import type { WithMethods } from '../../src/entity-methods.js'
import { Builder } from '../../src/query/index.js'
import { NodeEntity, Property } from '../../src/decorators/index.js'
import type { Newable } from '../../src/meta/newable.js'
import type { FactoryBuilder } from '../../src/services/factory.service.js'

@NodeEntity()
class TypePerson {
  @Property({ type: 'string', primary: true })
  id!: string

  @Property({ type: 'number' })
  age!: number

  @Property({ type: 'string' })
  name!: string
}

describe('public API type inference', () => {
  it('hydrate() yields WithMethods<T> arrays of the entity class', () => {
    const records: Array<{
      get: (key: string) => unknown
      has: (key: string) => boolean
      keys: string[]
    }> = []

    const entities = hydrate(TypePerson, { records })

    expectTypeOf(entities).toEqualTypeOf<WithMethods<TypePerson>[]>()
    expectTypeOf(entities.length).toEqualTypeOf<number>()
  })

  it('defineModel() returns a constructible virtual class', () => {
    const Model = defineModel('TypeTestModel', {
      title: { type: 'string', index: true },
      rank: 'number',
    })

    expectTypeOf(Model).toBeConstructibleWith()
  })

  it('the builder chain keeps method chaining and returns query + params', () => {
    const builder = new Builder().match('this', 'Person').where('this.name', 'Adam').return('this')

    const built = builder.build()

    expectTypeOf(built.query).toEqualTypeOf<string>()
    expectTypeOf(built.params).toEqualTypeOf<Record<string, unknown>>()
  })

  it('model schemas resolve by name to the registered model constructor', () => {
    defineModel('TypeSchemaProbe', { name: 'string' })

    const model = getModelByName('TypeSchemaProbe')

    expectTypeOf(model).toExtend<Newable | undefined>()
  })

  it('factory builders type create/make overrides against the model (NTS-167)', () => {
    const builder = {} as unknown as FactoryBuilder<TypePerson>

    expectTypeOf(builder.create).parameter(0).toEqualTypeOf<Partial<TypePerson> | undefined>()
    expectTypeOf(builder.make).parameter(0).toEqualTypeOf<Partial<TypePerson> | undefined>()

    expectTypeOf(builder.create).returns.toEqualTypeOf<Promise<TypePerson | TypePerson[]>>()
    expectTypeOf(builder.make).returns.toEqualTypeOf<Promise<TypePerson | TypePerson[]>>()
  })
})

describe('INeode#find id typing (NTS-502)', () => {
  it('accepts string | number ids on every scope', () => {
    const neode = {} as unknown as import('../../src/index.js').default
    const tx = {} as unknown as import('../../src/index.js').INeode

    class NumKey {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typing fixture
      id!: number
    }

    expectTypeOf(neode.find<NumKey>)
      .parameter(1)
      .toEqualTypeOf<string | number>()
    expectTypeOf(tx.find<NumKey>)
      .parameter(1)
      .toEqualTypeOf<string | number>()
  })
})
