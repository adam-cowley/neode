import { describe, expect, it } from 'vitest'
import { getModel, mergeRelationshipProperty } from '../../../src/meta/index.js'
import { defineModel } from '../../../src/meta/map-schema.js'
import { Direction } from '../../../src/query/index.js'
import { ReplaceRelationshipService } from '../../../src/services/query/replace-relationship.service.js'
import { FakeRunner } from './fake-runner.js'

const Membership = defineModel('Nts634ReplaceMembership', {
  id: { type: 'string', primary: true },
})

const Form = defineModel('Nts634ReplaceForm', {
  id: { type: 'string', primary: true },
  ASSIGNED_TO: {
    type: 'relationships',
    relationship: 'ASSIGNED_TO',
    direction: 'out',
    target: 'Nts634ReplaceMembership',
  },
})

// BOTH is match-only (NTS-483) — replaceRelationship must reject it up front
mergeRelationshipProperty(Form, 'MANAGER', 'MANAGER', Membership, Direction.BOTH, false)

const schema = getModel(Form)

const assignedTo = schema.getRelationship('ASSIGNED_TO')

describe('ReplaceRelationshipService (NTS-634 one-statement edge replace)', () => {
  it('deletes existing edges and creates the new set in one statement', async () => {
    const runner = new FakeRunner()

    await new ReplaceRelationshipService(runner).replaceRelationship(
      schema,
      { id: 'form-1' },
      assignedTo,
      ['m-1', 'm-2'],
    )

    expect(runner.statements).toEqual([
      {
        query: [
          'MATCH (this:Nts634ReplaceForm { id: $this_id })',
          'OPTIONAL MATCH (this)-[old_rel:`ASSIGNED_TO`]->()',
          'DELETE old_rel',
          'WITH this',
          'UNWIND $targets AS t',
          'MATCH (target_node:Nts634ReplaceMembership { id: t })',
          'CREATE (this)-[new_rel:`ASSIGNED_TO`]->(target_node)',
        ].join('\n'),
        params: { this_id: 'form-1', targets: ['m-1', 'm-2'] },
      },
    ])
  })

  it('uses the same zero-edge-safe statement for entity-instance targets', async () => {
    const runner = new FakeRunner()

    await new ReplaceRelationshipService(runner).replaceRelationship(
      schema,
      { id: 'form-1' },
      assignedTo,
      [{ id: 'm-1' }, 'm-2'],
    )

    // Identical shape whether or not edges pre-exist: the OPTIONAL MATCH
    // keeps the row alive on an empty edge set; instances resolve to
    // their primary-key values
    expect(runner.statements[0]?.params).toEqual({ this_id: 'form-1', targets: ['m-1', 'm-2'] })
  })

  it('SETs the given properties on every created edge', async () => {
    const runner = new FakeRunner()

    await new ReplaceRelationshipService(runner).replaceRelationship(
      schema,
      { id: 'form-1' },
      assignedTo,
      ['m-1'],
      { assignedAt: '2026-11-10' },
    )

    expect(runner.statements).toEqual([
      {
        query: [
          'MATCH (this:Nts634ReplaceForm { id: $this_id })',
          'OPTIONAL MATCH (this)-[old_rel:`ASSIGNED_TO`]->()',
          'DELETE old_rel',
          'WITH this',
          'UNWIND $targets AS t',
          'MATCH (target_node:Nts634ReplaceMembership { id: t })',
          'CREATE (this)-[new_rel:`ASSIGNED_TO`]->(target_node)',
          'SET new_rel.`assignedAt` = $set_0',
        ].join('\n'),
        params: { this_id: 'form-1', targets: ['m-1'], set_0: '2026-11-10' },
      },
    ])
  })

  it('MERGEs the new edges with the merge option', async () => {
    const runner = new FakeRunner()

    await new ReplaceRelationshipService(runner).replaceRelationship(
      schema,
      { id: 'form-1' },
      assignedTo,
      ['m-1'],
      {},
      { merge: true },
    )

    expect(runner.statements[0]?.query).toContain(
      'MERGE (this)-[new_rel:`ASSIGNED_TO`]->(target_node)',
    )
  })

  it('renders the declared direction on both the old-edge delete and the create', async () => {
    mergeRelationshipProperty(
      Form,
      'REPORTS_TO',
      'REPORTS_TO',
      Membership,
      Direction.INCOMING,
      false,
    )

    const runner = new FakeRunner()

    await new ReplaceRelationshipService(runner).replaceRelationship(
      schema,
      { id: 'form-1' },
      schema.getRelationship('REPORTS_TO'),
      ['m-1'],
    )

    expect(runner.statements[0]?.query).toBe(
      [
        'MATCH (this:Nts634ReplaceForm { id: $this_id })',
        'OPTIONAL MATCH (this)<-[old_rel:`REPORTS_TO`]-()',
        'DELETE old_rel',
        'WITH this',
        'UNWIND $targets AS t',
        'MATCH (target_node:Nts634ReplaceMembership { id: t })',
        'CREATE (this)<-[new_rel:`REPORTS_TO`]-(target_node)',
      ].join('\n'),
    )
  })

  it('rejects BOTH-direction declarations before any statement runs', async () => {
    const runner = new FakeRunner()

    await expect(
      new ReplaceRelationshipService(runner).replaceRelationship(
        schema,
        { id: 'form-1' },
        schema.getRelationship('MANAGER'),
        ['m-1'],
      ),
    ).rejects.toThrow('direction BOTH')

    expect(runner.statements).toHaveLength(0)
  })

  it('rejects entity-instance targets with no primary-key value', async () => {
    const runner = new FakeRunner()

    await expect(
      new ReplaceRelationshipService(runner).replaceRelationship(
        schema,
        { id: 'form-1' },
        assignedTo,
        [{}, 'm-2'],
      ),
    ).rejects.toThrow('a target instance is missing a id value')
  })
})
