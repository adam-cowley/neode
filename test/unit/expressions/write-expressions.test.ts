import { describe, expect, it } from 'vitest'
import { INTERNAL_ID, THIS_NODE } from '../../../src/constants.js'
import type {
  ConnectionProvider,
  GraphNode,
  QueryOutput,
  QueryParams,
  QueryRecord,
  TransactionHandle,
} from '../../../src/driver/types.js'
import { getModel } from '../../../src/meta/index.js'
import { defineModel } from '../../../src/meta/map-schema.js'
import { Neode } from '../../../src/neode.service.js'
import { RawExpression } from '../../../src/query/index.js'
import { MergeService } from '../../../src/services/query/merge.service.js'
import { ValidationError } from '../../../src/validation/validation-error.js'

const AuditEvent = defineModel('WriteExprEvent629', {
  id: { type: 'string', primary: true },
  seq: { type: 'number' },
  prevHash: { type: 'string' },
  crossRefKey: { type: 'string' },
  stamp: { type: 'number' },
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

function eventNode(): GraphNode {
  return {
    elementId: '4:nts629:1',
    labels: ['WriteExprEvent629'],
    properties: { id: 'e-1' },
  }
}

/**
ConnectionProvider stub scripted with canned outputs, replayed in
statement order — every statement recorded. No database.
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

describe('write-path expression properties (NTS-629)', () => {
  it('create() renders an expression property as a trailing SET with the verbatim expression', async () => {
    const provider = new ScriptedProvider(writtenRow(eventNode()))
    const neode = new Neode(provider)

    await neode.create(AuditEvent, {
      id: 'e-1',
      prevHash: new RawExpression('left($this_id, 8)'),
    })

    // One statement: CREATE + SET + RETURN
    expect(provider.statements).toHaveLength(1)

    const query = provider.statements[0]?.query ?? ''

    // Trailing SET clause — verbatim expression, identifier quoted
    expect(query).toContain('SET this.`prevHash` = left($this_id, 8)')

    // Not inline in the CREATE pattern (inside the pattern `this` is not bound)
    expect(query).not.toContain('prevHash:')
  })

  it('one create runs exactly one statement and preserves map order across expressions', async () => {
    const provider = new ScriptedProvider(writtenRow(eventNode()))
    const neode = new Neode(provider)

    await neode.create(AuditEvent, {
      id: 'e-1',
      seq: 1,
      crossRefKey: new RawExpression("$this_id + '-' + toString(this.seq)"),
      stamp: new RawExpression('size(this.crossRefKey)'),
    })

    expect(provider.statements).toHaveLength(1)

    const query = provider.statements[0]?.query ?? ''

    // One SET clause, expressions in schema order: the second reads the
    // property the first wrote, and $this_id is the literal id's bound
    // parameter
    expect(query).toContain(
      "SET this.`crossRefKey` = $this_id + '-' + toString(this.seq), this.`stamp` = size(this.crossRefKey)",
    )

    // The literals stay inline in the pattern, bound as parameters
    expect(provider.statements[0]?.params).toMatchObject({ this_id: 'e-1', this_seq: 1 })
  })

  it('literal properties still validate — a bad value throws before any statement', async () => {
    const provider = new ScriptedProvider(writtenRow(eventNode()))
    const neode = new Neode(provider)

    await expect(neode.create(AuditEvent, { id: 'e-1', seq: 'not-a-number' })).rejects.toThrowError(
      ValidationError,
    )

    expect(provider.statements).toHaveLength(0)
  })

  it('expression values skip property validation at write time', async () => {
    const provider = new ScriptedProvider(writtenRow(eventNode()))
    const neode = new Neode(provider)

    // prevHash is declared { type: 'string' } — a RawExpression carries no
    // JavaScript value to validate, so no ValidationError (the stored
    // value is checked on the next read)
    await expect(
      neode.create(AuditEvent, {
        id: 'e-1',
        prevHash: new RawExpression('datetime()'),
      }),
    ).resolves.toBeDefined()

    expect(provider.statements).toHaveLength(1)
  })

  it('mergeOn() renders expression set values identically', async () => {
    const provider = new ScriptedProvider({
      ...writtenRow(eventNode()),
      summary: { counters: { nodesCreated: 1 } },
    })
    const neode = new Neode(provider)

    await neode.mergeOn(
      AuditEvent,
      { id: 'e-1' },
      { prevHash: new RawExpression('left($this_id, 8)') },
    )

    expect(provider.statements).toHaveLength(1)

    const query = provider.statements[0]?.query ?? ''

    expect(query).toContain('MERGE')
    expect(query).toContain('SET this.prevHash = left($this_id, 8)')
    expect(query).not.toContain('prevHash:')
  })

  it('MergeService.save renders expression values identically on the merge path', async () => {
    const provider = new ScriptedProvider({
      ...writtenRow(eventNode()),
      summary: { counters: { nodesCreated: 1 } },
    })

    await new MergeService(provider).save(
      { id: 'e-1', prevHash: new RawExpression('left($this_id, 8)') },
      getModel(AuditEvent),
    )

    expect(provider.statements).toHaveLength(1)
    expect(provider.statements[0]?.query).toContain('SET this.prevHash = left($this_id, 8)')
  })
})
