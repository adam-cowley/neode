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
})
