import { describe, expect, it } from 'vitest'
import { INTERNAL_ID, THIS_NODE } from '../../../src/constants.js'
import type { GraphNode } from '../../../src/driver/types.js'
import { getModel } from '../../../src/meta/index.js'
import { defineModel } from '../../../src/meta/map-schema.js'
import { Neode } from '../../../src/neode.service.js'
import { CreateService } from '../../../src/services/query/create.service.js'
import { MergeService } from '../../../src/services/query/merge.service.js'
import { writtenRow, WriteCaptureRunner } from './fake-runner.js'
import { ScriptedProvider } from './scripted-provider.js'

const Membership = defineModel('Nts627Membership', {
  id: { type: 'string', primary: true },
})

const Submission = defineModel('Nts627Submission', {
  id: { type: 'string', primary: true },
  title: { type: 'string' },
  membership: {
    type: 'relationship',
    relationship: 'SUBMITTED_BY',
    direction: 'out',
    target: 'Nts627Membership',
  },
})

const schema = getModel(Submission)

describe('nested relationship targets on create (NTS-627)', () => {
  it('relates a primary-key value target in the root CREATE statement — one statement', async () => {
    const runner = new WriteCaptureRunner()

    await new CreateService(runner).create(schema, { id: 's-1', membership: 'm-1' })

    expect(runner.statements).toEqual([
      {
        query: [
          'MATCH (membership_0_target:Nts627Membership { id: $membership_0_target_id })',
          'CREATE (this:Nts627Submission { id: $this_id })',
          'CREATE (this)-[membership_0_rel:`SUBMITTED_BY`]->(membership_0_target)',
          `RETURN ${THIS_NODE}, elementId(${THIS_NODE}) AS ${INTERNAL_ID}`,
        ].join('\n'),
        params: { membership_0_target_id: 'm-1', this_id: 's-1' },
      },
    ])
  })

  it('creates an entity-instance target through the recursive walk and merges the edge', async () => {
    const runner = new WriteCaptureRunner()

    await new CreateService(runner).create(schema, {
      id: 's-1',
      membership: { id: 'm-1' },
    })

    expect(runner.statements).toHaveLength(3)

    // The edge statement is a MERGE — re-running the create never duplicates it
    expect(runner.statements[2]?.query).toContain('MERGE (from)-[rel:`SUBMITTED_BY`]->(to)')
  })

  it('fails loudly naming the relationship key and value when a pk target does not exist', async () => {
    const runner = new WriteCaptureRunner({ records: [] })

    await expect(
      new CreateService(runner).create(schema, { id: 's-1', membership: 'm-404' }),
    ).rejects.toThrow(/membership.*m-404/)
  })

  it('throws naming the fix when a create key declares no property or relationship', async () => {
    const runner = new WriteCaptureRunner()

    await expect(
      new CreateService(runner).create(schema, { id: 's-1', oopsTitle: 'x' }),
    ).rejects.toThrow(/oopsTitle/)

    // Nothing ran — the throw happens before any statement
    expect(runner.statements).toHaveLength(0)
  })

  it('save() round-trips a pk-value target with MERGE — no edge duplication', async () => {
    const runner = new WriteCaptureRunner()

    const service = new MergeService(runner)

    await service.save({ id: 's-1', membership: 'm-1' }, schema)
    await service.save({ id: 's-1', membership: 'm-1' }, schema)

    // Root MERGE + one pk-relate MERGE per save — the edge never duplicates
    expect(runner.statements).toHaveLength(4)

    expect(runner.statements[1]?.query).toEqual(
      [
        'MATCH (from)',
        'WHERE (elementId(from) = $where_from_id)',
        'MATCH (to:Nts627Membership { id: $to_id })',
        'MERGE (from)-[rel:`SUBMITTED_BY`]->(to)',
        'RETURN to',
      ].join('\n'),
    )

    // Idempotent: the second save emits the same MERGE, not a CREATE
    expect(runner.statements[3]?.query).toEqual(runner.statements[1]?.query)
  })
})

describe('facade create() with the composed options carrier (NTS-627/628)', () => {
  it('accepts the relationshipProperties carrier and hydrates the written node', async () => {
    const node: GraphNode = {
      elementId: '4:nts627:1',
      labels: ['Nts627Submission'],
      properties: { id: 's-1', title: 'First' },
    }

    const provider = new ScriptedProvider(writtenRow(node))

    const neode = new Neode(provider)

    const created = await neode.create(
      Submission,
      { id: 's-1', title: 'First', membership: 'm-1' },
      { relationshipProperties: { membership: { note: 'intro' } } },
    )

    // One statement: MATCH target + CREATE node + CREATE edge + RETURN
    expect(provider.statements).toHaveLength(1)
    expect(created).toMatchObject({ id: 's-1', title: 'First' })

    const statement = provider.statements[0]

    expect(statement?.query).toContain(
      'CREATE (this)-[membership_0_rel:`SUBMITTED_BY` { note: $membership_0_rel_note }]->(membership_0_target)',
    )
    expect(statement?.params).toMatchObject({ membership_0_rel_note: 'intro' })
  })

  it('still accepts the positional database string', async () => {
    const node: GraphNode = {
      elementId: '4:nts627:1',
      labels: ['Nts627Submission'],
      properties: { id: 's-1' },
    }

    const provider = new ScriptedProvider(writtenRow(node))

    const neode = new Neode(provider)

    const created = await neode.create(Submission, { id: 's-1' }, 'neo4j')

    expect(created).toMatchObject({ id: 's-1' })
    expect(provider.statements).toHaveLength(1)
  })
})
