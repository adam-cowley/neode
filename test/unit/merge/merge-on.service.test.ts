import { describe, expect, it } from 'vitest'
import { INTERNAL_ID } from '../../../src/constants.js'
import type {
  QueryOutput,
  QueryParams,
  QueryRecord,
  QuerySummary,
  Runner,
} from '../../../src/driver/types.js'
import { getModel } from '../../../src/meta/index.js'
import { defineModel } from '../../../src/meta/map-schema.js'
import { MergeService, mergeOutcome } from '../../../src/services/query/merge.service.js'

const SeedUser = defineModel('MergeOnOutcomeSeedUser', {
  id: { type: 'string', unique: true },
  name: { type: 'string' },
})

/**
Runner stub: replays canned QueryOutputs in statement order and records
every statement — no database.
*/
class StubRunner implements Runner {
  readonly statements: { query: string; params: QueryParams }[] = []

  private readonly outputs: QueryOutput[]

  constructor(outputs: QueryOutput[]) {
    this.outputs = outputs
  }

  async run(query: string, params?: QueryParams): Promise<QueryOutput> {
    this.statements.push({ query, params: params ?? {} })

    return this.outputs[this.statements.length - 1] ?? { records: [] }
  }
}

function recordWithElementId(elementId: string): QueryRecord {
  return {
    get(key: string): unknown {
      return key === INTERNAL_ID ? elementId : undefined
    },
    has(key: string): boolean {
      return key === INTERNAL_ID
    },
    keys: [INTERNAL_ID],
  }
}

function mergeOutput(summary: QuerySummary | undefined, elementId = '4:nts630:1'): QueryOutput {
  return { records: [recordWithElementId(elementId)], summary }
}

describe('MergeService.mergeOn outcome (NTS-630)', () => {
  it('MERGEs on the match properties and reports a fresh match as created', async () => {
    const runner = new StubRunner([
      mergeOutput({ counters: { nodesCreated: 1, propertiesSet: 2 } }),
    ])

    const output = await new MergeService(runner).mergeOn(
      getModel(SeedUser),
      { id: 'seed-1' },
      { name: 'Ada' },
    )

    expect(output.records[0]?.get(INTERNAL_ID)).toBe('4:nts630:1')
    expect(runner.statements[0]?.query).toContain('MERGE')
    expect(runner.statements[0]?.query).toContain('MergeOnOutcomeSeedUser')

    const outcome = mergeOutcome(output.summary)

    expect(outcome.created).toBe(true)
    expect(outcome.updated).toBe(false)
    expect(outcome.counts).toEqual({ nodes: 1, relationships: 0, properties: 2 })
  })

  it('reports a matched write as updated', async () => {
    const runner = new StubRunner([mergeOutput({ counters: { propertiesSet: 3 } })])

    const output = await new MergeService(runner).mergeOn(
      getModel(SeedUser),
      { id: 'seed-1' },
      { name: 'Ada' },
    )

    const outcome = mergeOutcome(output.summary)

    expect(outcome.created).toBe(false)
    expect(outcome.updated).toBe(true)
    expect(outcome.counts).toEqual({ nodes: 0, relationships: 0, properties: 3 })
  })

  it('rerunning a seeder is idempotent: the rerun matches with zero counters', async () => {
    // First run creates the node, the rerun matches it and changes nothing
    const runner = new StubRunner([
      mergeOutput({ counters: { nodesCreated: 1, propertiesSet: 1 } }),
      mergeOutput({ counters: {} }),
    ])

    const service = new MergeService(runner)
    const schema = getModel(SeedUser)

    const first = mergeOutcome(
      (await service.mergeOn(schema, { id: 'seed-1' }, { name: 'Ada' })).summary,
    )

    const second = mergeOutcome(
      (await service.mergeOn(schema, { id: 'seed-1' }, { name: 'Ada' })).summary,
    )

    expect(first.created).toBe(true)
    expect(second).toEqual({
      created: false,
      updated: false,
      counts: { nodes: 0, relationships: 0, properties: 0 },
    })

    // One MERGE statement per run — the rerun matched the same node
    // instead of duplicating it
    expect(runner.statements).toHaveLength(2)
  })
})
