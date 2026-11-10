import { describe, expect, it } from 'vitest'
import type { QuerySummary } from '../../../src/driver/types.js'
import { mergeOutcome, mergeResultFromSave } from '../../../src/services/query/merge.service.js'

function summary(counters: Record<string, number>): QuerySummary {
  return { counters }
}

describe('mergeOutcome (NTS-630)', () => {
  it('reports a fresh match as created, its property sets not as an update', () => {
    const outcome = mergeOutcome(summary({ nodesCreated: 1, propertiesSet: 2, labelsAdded: 1 }))

    expect(outcome.created).toBe(true)
    expect(outcome.updated).toBe(false)
    expect(outcome.counts).toEqual({ nodes: 1, relationships: 0, properties: 2 })
  })

  it('reports a matched write as updated', () => {
    const outcome = mergeOutcome(summary({ propertiesSet: 3 }))

    expect(outcome.created).toBe(false)
    expect(outcome.updated).toBe(true)
    expect(outcome.counts).toEqual({ nodes: 0, relationships: 0, properties: 3 })
  })

  it('reports a no-op merge (zero counters) as neither created nor updated', () => {
    const outcome = mergeOutcome(summary({}))

    expect(outcome.created).toBe(false)
    expect(outcome.updated).toBe(false)
    expect(outcome.counts).toEqual({ nodes: 0, relationships: 0, properties: 0 })
  })

  it('tolerates a missing summary', () => {
    const outcome = mergeOutcome(undefined)

    expect(outcome.created).toBe(false)
    expect(outcome.updated).toBe(false)
    expect(outcome.counts).toEqual({ nodes: 0, relationships: 0, properties: 0 })
  })

  it('reads the Relate engine snake_case counters', () => {
    const outcome = mergeOutcome(summary({ nodes_created: 1, relationships_created: 2 }))

    expect(outcome.created).toBe(true)
    expect(outcome.updated).toBe(false)
    expect(outcome.counts).toEqual({ nodes: 1, relationships: 2, properties: 0 })
  })

  it('aggregates creates and deletes per kind', () => {
    const outcome = mergeOutcome(
      summary({
        nodesCreated: 1,
        nodesDeleted: 1,
        relationshipsCreated: 2,
        relationshipsDeleted: 4,
      }),
    )

    expect(outcome.created).toBe(true)
    expect(outcome.counts).toEqual({ nodes: 2, relationships: 6, properties: 0 })
  })

  it('a deleted-only statement counts as an update, not a create', () => {
    const outcome = mergeOutcome(summary({ nodesDeleted: 1 }))

    expect(outcome.created).toBe(false)
    expect(outcome.updated).toBe(true)
  })
})

describe('mergeResultFromSave (NTS-630)', () => {
  it('the created flag stands even without a summary (pure-CREATE save branch)', () => {
    const result = mergeResultFromSave({ id: 'a' }, true, undefined)

    expect(result.created).toBe(true)
    expect(result.updated).toBe(false)
    expect(result.counts).toEqual({ nodes: 0, relationships: 0, properties: 0 })
  })

  it('derives the flags from the summary when the save carried one', () => {
    const result = mergeResultFromSave({ id: 'a' }, false, summary({ propertiesSet: 1 }))

    expect(result.created).toBe(false)
    expect(result.updated).toBe(true)
    expect(result.entity).toEqual({ id: 'a' })
  })
})
