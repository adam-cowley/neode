import { describe, expect, it } from 'vitest'
import { EventType, type QueryExecutedEvent } from '../../../src/common/events.js'
import { INTERNAL_ID, THIS_NODE } from '../../../src/constants.js'
import type {
  ConnectionProvider,
  GraphNode,
  QueryOutput,
  QueryParams,
  QueryRecord,
  TransactionHandle,
} from '../../../src/driver/types.js'
import { defineModel } from '../../../src/meta/map-schema.js'
import { Neode } from '../../../src/neode.service.js'

const Submission = defineModel('WriteHydrationSubmission633', {
  id: { type: 'string', primary: true },
  title: { type: 'string' },
  createdAt: { type: 'datetime', createdAt: true },
})

/** A hand-built QueryRecord over a plain map — no database */
function recordOf(values: Record<string, unknown>): QueryRecord {
  return {
    get: (key) => values[key],
    has: (key) => key in values,
    keys: Object.keys(values),
  }
}

/** The row a write statement returns: the node in `this`, its elementId in `__id` */
function writtenRow(node: GraphNode): QueryOutput {
  return {
    records: [
      recordOf({
        [THIS_NODE]: node,
        [INTERNAL_ID]: node.elementId,
      }),
    ],
  }
}

function submissionNode(overrides: Record<string, unknown> = {}): GraphNode {
  return {
    elementId: '4:nts633:1',
    labels: ['WriteHydrationSubmission633'],
    properties: {
      id: 's-1',
      title: 'First',
      createdAt: '2026-11-10T09:15:00.000Z',
      ...overrides,
    },
  }
}

/**
ConnectionProvider stub scripted with canned outputs, replayed in
statement order — every statement (in-transaction included) recorded.
No database.
*/
class ScriptedProvider implements ConnectionProvider {
  readonly statements: { query: string; params: QueryParams }[] = []

  private readonly outputs: QueryOutput[]

  constructor(...outputs: QueryOutput[]) {
    this.outputs = outputs
  }

  async run(query: string, params: QueryParams = {}): Promise<QueryOutput> {
    const index = this.statements.length

    this.statements.push({ query, params })

    return this.outputs[index] ?? { records: [] }
  }

  async beginTransaction(): Promise<TransactionHandle> {
    return {
      run: (query, params) => this.run(query, params),
      commit: async () => {},
      rollback: async () => {},
    }
  }

  async edition(): Promise<'unknown'> {
    return 'unknown'
  }

  async close(): Promise<void> {}
}

describe('write-path RETURN hydration (NTS-633)', () => {
  it('create() emits one statement ending in RETURN and hydrates the written node', async () => {
    const provider = new ScriptedProvider(writtenRow(submissionNode()))
    const neode = new Neode(provider)

    const created = await neode.create(Submission, { id: 's-1', title: 'First' })

    // One statement: the CREATE (a FindByIdService re-read would be a second)
    expect(provider.statements).toHaveLength(1)

    const statement = provider.statements[0]

    expect(statement?.query).toContain('CREATE (')
    expect(
      statement?.query
        .trimEnd()
        .endsWith(`RETURN ${THIS_NODE}, elementId(${THIS_NODE}) AS ${INTERNAL_ID}`),
    ).toBe(true)

    expect(created).toMatchObject({ id: 's-1', title: 'First' })
  })

  it('the created-at datetime() stamp is present on the hydrated entity without a re-read', async () => {
    const provider = new ScriptedProvider(writtenRow(submissionNode()))
    const neode = new Neode(provider)

    const created = await neode.create(Submission, { id: 's-1' })

    // The stamp exists only because the RETURNed node carried it — the
    // statement wrote `datetime()` server-side and no second read ran
    expect(provider.statements).toHaveLength(1)
    expect(created).toMatchObject({ id: 's-1', createdAt: '2026-11-10T09:15:00.000Z' })
  })

  it('one create runs exactly one statement (QUERY_EXECUTED count)', async () => {
    const provider = new ScriptedProvider(writtenRow(submissionNode()))
    const neode = new Neode(provider)

    const executed: QueryExecutedEvent[] = []

    neode.on(EventType.QUERY_EXECUTED, (event) => executed.push(event))

    await neode.create(Submission, { id: 's-1' })

    expect(executed).toHaveLength(1)
    expect(executed[0]?.cypher).toContain('CREATE (')
  })

  it('update() rehydrates the mutated properties from the RETURN', async () => {
    const provider = new ScriptedProvider(writtenRow(submissionNode({ title: 'Renamed' })))
    const neode = new Neode(provider)

    const entity = new Submission() as { id?: string; title?: string }

    entity.id = 's-1'

    const updated = await neode.update(entity, { title: 'Renamed' })

    expect(provider.statements).toHaveLength(1)
    expect(provider.statements[0]?.query).toContain('SET')

    expect(updated).toMatchObject({ id: 's-1', title: 'Renamed' })
  })

  it('mergeOn() hydrates from the MERGE RETURN and still returns the MergeResult', async () => {
    const provider = new ScriptedProvider({
      ...writtenRow(submissionNode({ title: 'Merged' })),
      summary: { counters: { nodesCreated: 1, propertiesSet: 3 } },
    })
    const neode = new Neode(provider)

    const result = await neode.mergeOn(Submission, { id: 's-1' }, { title: 'Merged' })

    expect(provider.statements).toHaveLength(1)
    expect(result?.entity).toMatchObject({ id: 's-1', title: 'Merged' })
    expect(result?.created).toBe(true)
    expect(result?.updated).toBe(false)
    expect(result?.counts).toEqual({ nodes: 1, relationships: 0, properties: 3 })
  })

  it('falls back to the FindByIdService re-read when the RETURN carries no node', async () => {
    const node = submissionNode()

    // First statement returns the elementId only — nothing hydratable
    const provider = new ScriptedProvider(
      { records: [recordOf({ [INTERNAL_ID]: node.elementId })] },
      writtenRow(node),
    )
    const neode = new Neode(provider)

    const created = await neode.create(Submission, { id: 's-1', title: 'First' })

    // The re-read ran as the second statement
    expect(provider.statements).toHaveLength(2)
    expect(provider.statements[1]?.query).toContain('MATCH')

    expect(created).toMatchObject({ id: 's-1', title: 'First' })
  })

  it('TransactionalService.save() hydrates from the merge RETURN in scope — one statement', async () => {
    const provider = new ScriptedProvider({
      ...writtenRow(submissionNode({ title: 'In tx' })),
      summary: { counters: { nodesCreated: 1 } },
    })
    const neode = new Neode(provider)

    const created: unknown[] = []

    neode.on(EventType.NODE_CREATED, (entity) => created.push(entity))

    const tx = await neode.openWriteTransaction()

    const entity = new Submission() as { id?: string; title?: string }

    entity.id = 's-1'
    entity.title = 'In tx'

    const saved = await tx.save(entity)

    await tx.commit()

    expect(provider.statements).toHaveLength(1)
    expect(saved).toMatchObject({ id: 's-1', title: 'In tx' })

    // The event fires off the same RETURN evidence
    expect(created).toHaveLength(1)
  })
})
