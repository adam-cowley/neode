import { describe, expect, it } from 'vitest'
import { getModel } from '../../../src/meta/index.js'
import { defineModel } from '../../../src/meta/map-schema.js'
import { Neode } from '../../../src/neode.service.js'
import { RelateService } from '../../../src/services/query/relate.service.js'
import { writtenRow, WriteCaptureRunner } from './fake-runner.js'
import { ScriptedProvider } from './scripted-provider.js'

const Tag = defineModel('Nts628Tag', {
  id: { type: 'string', primary: true },
})

const Article = defineModel('Nts628Article', {
  id: { type: 'string', primary: true },
  tags: {
    type: 'relationships',
    relationship: 'TAGGED',
    direction: 'out',
    target: 'Nts628Tag',
    properties: {
      addedAt: 'datetime',
      weight: 'number',
    },
  },
})

describe('edge properties on declared relationships (NTS-628)', () => {
  it('relate() upserts edge properties — ON CREATE SET and ON MATCH SET', async () => {
    const runner = new WriteCaptureRunner()

    const schema = getModel(Article)

    await new RelateService(runner).relate(
      schema,
      { id: 'a-1' },
      { id: 't-1' },
      schema.getRelationship('tags'),
      { addedAt: '2026-11-10T00:00:00Z' },
    )

    expect(runner.statements).toEqual([
      {
        query: [
          'MATCH (from:Nts628Article { id: $from_id })',
          'MATCH (to:Nts628Tag { id: $to_id })',
          'MERGE (from)-[rel:`TAGGED`]->(to)',
          'ON CREATE SET rel.`addedAt` = $set_0',
          'ON MATCH SET rel.`addedAt` = $set_1',
          'RETURN rel',
        ].join('\n'),
        params: {
          from_id: 'a-1',
          to_id: 't-1',
          set_0: '2026-11-10T00:00:00Z',
          set_1: '2026-11-10T00:00:00Z',
        },
      },
    ])
  })

  it('forceCreate keeps the plain SET (ON CREATE SET is merge-only)', async () => {
    const runner = new WriteCaptureRunner()

    const schema = getModel(Article)

    await new RelateService(runner).relate(
      schema,
      { id: 'a-1' },
      { id: 't-1' },
      schema.getRelationship('tags'),
      { weight: 2 },
      true,
    )

    expect(runner.statements[0]?.query).toContain('CREATE (from)-[rel:`TAGGED`]->(to)')
    expect(runner.statements[0]?.query).toContain('SET rel.`weight` = $set_0')
  })

  it('updateEdgeProperties is idempotent — MERGE + SET twice, no edge duplication', async () => {
    const runner = new WriteCaptureRunner()

    const service = new RelateService(runner)

    const schema = getModel(Article)

    await service.updateEdgeProperties(
      schema,
      { id: 'a-1' },
      schema.getRelationship('tags'),
      { id: 't-1' },
      { weight: 2 },
    )

    await service.updateEdgeProperties(
      schema,
      { id: 'a-1' },
      schema.getRelationship('tags'),
      { id: 't-1' },
      { weight: 2 },
    )

    // Two identical statements, both MERGE — the edge never duplicates
    expect(runner.statements).toHaveLength(2)
    expect(runner.statements[0]?.query).toEqual(runner.statements[1]?.query)
    expect(runner.statements[0]?.query).toContain('MERGE (from)-[rel:`TAGGED`]->(to)')
    expect(runner.statements[0]?.query).toContain('SET rel.`weight` = $set_0')
    expect(runner.statements[0]?.query).not.toContain('CREATE (from)')
  })

  it('throws naming the relationship key for an undeclared edge property', async () => {
    const runner = new WriteCaptureRunner()

    const schema = getModel(Article)

    await expect(
      new RelateService(runner).updateEdgeProperties(
        schema,
        { id: 'a-1' },
        schema.getRelationship('tags'),
        { id: 't-1' },
        { nope: 1 },
      ),
    ).rejects.toThrow(/Unknown edge property "nope" on relationship "tags"/)
  })

  it('throws naming the key when an edge property has the wrong type', async () => {
    const runner = new WriteCaptureRunner()

    const schema = getModel(Article)

    await expect(
      new RelateService(runner).relate(
        schema,
        { id: 'a-1' },
        { id: 't-1' },
        schema.getRelationship('tags'),
        { weight: 'heavy' },
      ),
    ).rejects.toThrow(/Edge property "weight" on relationship "tags" failed validation/)
  })

  it('accepts literal edge properties when the relationship declares no schema', async () => {
    const runner = new WriteCaptureRunner()

    // A model whose relationship declares NO properties key: literals pass
    // (relate() parity)
    const submissionSchema = getModel(
      defineModel('Nts628Plain', {
        id: { type: 'string', primary: true },
        tags: {
          type: 'relationships',
          relationship: 'TAGGED',
          direction: 'out',
          target: 'Nts628Tag',
        },
      }),
    )

    await new RelateService(runner).relate(
      submissionSchema,
      { id: 'a-1' },
      { id: 't-1' },
      submissionSchema.getRelationship('tags'),
      { anything: 'goes' },
    )

    expect(runner.statements[0]?.query).toContain('SET rel.`anything` = $set_0')
  })
})

describe('edge properties on nested creates (NTS-628)', () => {
  it('validates carrier edge props against the declared properties schema before any statement', async () => {
    const provider = new ScriptedProvider()

    const neode = new Neode(provider)

    await expect(
      neode.create(
        Article,
        { id: 'a-1', tags: 't-1' },
        { relationshipProperties: { tags: { nope: 1 } } },
      ),
    ).rejects.toThrow(/nope/)

    expect(provider.statements).toHaveLength(0)
  })

  it('renders declared edge properties inline on the created edge', async () => {
    const provider = new ScriptedProvider(
      writtenRow({
        elementId: '4:nts628:1',
        labels: ['Nts628Article'],
        properties: { id: 'a-1' },
      }),
    )

    const neode = new Neode(provider)

    await neode.create(
      Article,
      { id: 'a-1', tags: 't-1' },
      { relationshipProperties: { tags: { addedAt: '2026-11-10T00:00:00Z', weight: 2 } } },
    )

    // One statement: MATCH target + CREATE node + CREATE edge (props inline) + RETURN
    expect(provider.statements).toHaveLength(1)

    expect(provider.statements[0]?.query).toContain(
      'CREATE (this)-[tags_0_rel:`TAGGED` { addedAt: $tags_0_rel_addedAt, weight: $tags_0_rel_weight }]->(tags_0_target)',
    )
  })
})
