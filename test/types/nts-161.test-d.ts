/**
Type-level tests for NTS-161 — the cardinality declaration positions
(decorator config, decorator positional, map-API definition) and the
syncEdges signatures. Run with `pnpm test:types` (vitest typecheck mode).
*/
import { describe, expectTypeOf, it } from 'vitest'
import { OneToMany, OneToOne } from '../../src/decorators/index.js'
import type { RelationshipConfig } from '../../src/decorators/index.js'
import type { RelationshipCardinality } from '../../src/meta/index.js'
import type { RelationshipDefinition, SchemaDefinition } from '../../src/index.js'
import type { SyncEdgesOptions, SyncEdgesResult } from '../../src/index.js'
import type { EntityMethods } from '../../src/index.js'
import type { Neode } from '../../src/neode.service.js'
import type { TransactionalService } from '../../src/transaction/transactional.service.js'

describe('NTS-161: cardinality declaration positions', () => {
  it('RelationshipCardinality is the one / zeroOrOne / many union', () => {
    expectTypeOf<'one'>().toExtend<RelationshipCardinality>()
    expectTypeOf<'zeroOrOne'>().toExtend<RelationshipCardinality>()
    expectTypeOf<'many'>().toExtend<RelationshipCardinality>()
    expectTypeOf<'sometimes'>().not.toExtend<RelationshipCardinality>()
  })

  it('the @OneToOne config accepts a cardinality', () => {
    expectTypeOf<
      NonNullable<RelationshipConfig['cardinality']>
    >().toExtend<RelationshipCardinality>()
    expectTypeOf<RelationshipCardinality>().toExtend<
      NonNullable<RelationshipConfig['cardinality']>
    >()
    expectTypeOf<undefined>().toExtend<RelationshipConfig['cardinality']>()

    // and the decorator itself takes that config as its only parameter
    expectTypeOf<Parameters<typeof OneToOne>[0]>().toExtend<RelationshipConfig>()
  })

  it('the @OneToMany positional cardinality accepts the union', () => {
    expectTypeOf<'many'>().toExtend<Parameters<typeof OneToMany>[6]>()
    expectTypeOf<undefined>().toExtend<Parameters<typeof OneToMany>[6]>()
  })

  it('the map API accepts a cardinality on a relationship definition', () => {
    const schema = {
      role: {
        type: 'relationship',
        relationship: 'ROLE',
        direction: 'out',
        target: 'Role',
        cardinality: 'one',
      },
    } satisfies SchemaDefinition

    expectTypeOf(schema).toExtend<SchemaDefinition>()

    expectTypeOf<'one' | 'zeroOrOne' | 'many' | undefined>().toExtend<
      RelationshipDefinition['cardinality']
    >()
  })
})

describe('NTS-161: syncEdges signatures', () => {
  it('the facade takes (constructor, from, relationshipKey, targets, options?, database?)', () => {
    expectTypeOf<Parameters<Neode['syncEdges']>[3]>().toExtend<object[]>()
    expectTypeOf<Parameters<Neode['syncEdges']>[4]>().toExtend<SyncEdgesOptions | undefined>()
    expectTypeOf<ReturnType<Neode['syncEdges']>>().toExtend<Promise<SyncEdgesResult>>()
  })

  it('the transactional mirror takes (constructor, from, relationshipKey, targets, options?)', () => {
    expectTypeOf<Parameters<TransactionalService['syncEdges']>[3]>().toExtend<object[]>()
    expectTypeOf<ReturnType<TransactionalService['syncEdges']>>().toExtend<
      Promise<SyncEdgesResult>
    >()
  })

  it('the entity instance method takes (relationshipKey, targets, options?)', () => {
    expectTypeOf<Parameters<EntityMethods['syncEdges']>[0]>().toExtend<string>()
    expectTypeOf<Parameters<EntityMethods['syncEdges']>[1]>().toExtend<object[]>()
    expectTypeOf<Parameters<EntityMethods['syncEdges']>[2]>().toExtend<
      SyncEdgesOptions | undefined
    >()

    expectTypeOf<ReturnType<EntityMethods['syncEdges']>>().toExtend<Promise<SyncEdgesResult>>()
  })

  it('the properties callback is keyed by target and index', () => {
    expectTypeOf<NonNullable<SyncEdgesOptions['properties']>>().toExtend<
      (target: object, index: number) => Record<string, unknown>
    >()
  })
})
