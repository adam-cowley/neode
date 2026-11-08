/**
Type-level tests for NTS-483 — Direction.BOTH is accepted in every
direction position (decorator configs, decorator positional, map-API
definition). Run with `pnpm test:types` (vitest typecheck mode).
*/
import { describe, expectTypeOf, it } from 'vitest'
import { OneToMany } from '../../src/decorators/index.js'
import { Direction } from '../../src/query/index.js'
import type { ProjectionDirection, RelatedConfig } from '../../src/decorators/index.js'
import type { SchemaDefinition } from '../../src/index.js'

describe('NTS-483: BOTH is accepted in the direction positions', () => {
  it('Direction.BOTH is a Direction; "both" is a ProjectionDirection', () => {
    expectTypeOf<(typeof Direction)['BOTH']>().toExtend<Direction>()
    expectTypeOf<'both'>().toExtend<ProjectionDirection>()
  })

  it('the @OneToMany positional direction accepts BOTH', () => {
    expectTypeOf<(typeof Direction)['BOTH']>().toExtend<Parameters<typeof OneToMany>[2]>()
  })

  it('the @RelatedOne / @RelatedMany config direction accepts BOTH and the "both" spelling', () => {
    expectTypeOf<(typeof Direction)['BOTH']>().toExtend<RelatedConfig['direction']>()
    expectTypeOf<'both'>().toExtend<RelatedConfig['direction']>()
  })

  it('the map API accepts direction "both" on a relationship definition', () => {
    const schema = {
      likes: {
        type: 'relationships',
        relationship: 'LIKES',
        direction: 'both',
        target: 'Movie',
      },
    } satisfies SchemaDefinition

    expectTypeOf(schema).toExtend<SchemaDefinition>()
  })
})
