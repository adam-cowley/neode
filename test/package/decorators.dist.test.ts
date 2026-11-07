/**
 * Phase 3 spike gate: standard decorators must survive the tsdown build.
 * Imports the BUILT dist — ESM and CJS, not src — and round-trips a
 * decorated model's registration + hydration.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'module'

import { NodeEntity, OneToOne, Property, hydrate } from '../../dist/index.mjs'
import type { GraphNode, QueryOutput, QueryRecord } from '../../dist/index.mjs'

// The CJS build of the same package
const require = createRequire(import.meta.url)
const cjs = require('../../dist/index.cjs') as typeof import('../../dist/index.mjs')

/** One record per properties-map: the `this` column carries a driver-shaped node. */
function output(records: Array<Record<string, unknown>>): QueryOutput {
  return {
    records: records.map((properties) => {
      const node = {
        elementId: '4:dist:1',
        labels: ['DistPerson'],
        properties,
      } as unknown as GraphNode

      return {
        get: (key: string) => (key === 'this' ? node : undefined),
        has: (key: string) => key === 'this',
        keys: ['this'],
      } satisfies QueryRecord
    }),
  }
}

@NodeEntity()
class DistPerson {
  @Property({ type: 'string', primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string

  @OneToOne({ type: 'LIKES', target: () => DistPerson, direction: 'OUTGOING' })
  likes: DistPerson | undefined
}

const { NodeEntity: CjsNodeEntity, Property: CjsProperty, hydrate: cjsHydrate } = cjs

@CjsNodeEntity()
class DistPersonCjs {
  @CjsProperty({ type: 'string', primary: true })
  id!: string

  @CjsProperty({ type: 'string' })
  name!: string
}

describe('built dist: standard decorators survive the tsdown build', () => {
  it('registers and hydrates a decorated model from the ESM build', () => {
    const [entity] = hydrate(DistPerson, output([{ id: 'p1', name: 'Adam' }]))

    expect(entity.id).toBe('p1')
    expect(entity.name).toBe('Adam')
  })

  it('registers and hydrates a decorated model from the CJS build', () => {
    const [entity] = cjsHydrate(DistPersonCjs, output([{ id: 'c1', name: 'Ada' }]))

    expect(entity.id).toBe('c1')
    expect(entity.name).toBe('Ada')
  })
})
