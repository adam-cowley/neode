// NTS-663 — the Cypher contract of the enforce/claim feature, path by path.
//
// Every claim-maintaining statement is captured against a scripted runner
// and asserted structurally (no database): the refuse WHERE, the detach
// FOREACH comprehension, the throw probe, the delete-path CALL subqueries,
// and the nested-create walk four levels deep.
import { describe, expect, it } from 'vitest'
import { InternalId, NodeEntity, OneToOne, String, Uuid } from '../../src/decorators'
import { Direction } from '../../src/query'
import { getModel } from '../../src/meta'
import type { Newable } from '../../src/meta/newable'
import { createNodeAndRelationships } from '../../src/services/write-utilities'
import { RelateService } from '../../src/services/query/relate.service'
import { DeleteService } from '../../src/services/query/delete.service'
import { INTERNAL_ID } from '../../src/constants'
import type { EntitySchema } from '../../src/meta/entity/entity-schema'
import type { QueryOutput, Runner } from '../../src/driver/types'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class U1Leaf {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  holderId: string | undefined
}

// One relationship shape, four levels deep: L0 -> L1 -> L2 -> L3 -> Leaf.
// Each level claims the next through a @Unique `holderId` on the target.
@NodeEntity()
class U1Level3 {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  holderId: string | undefined

  @OneToOne({
    type: 'U1_NEXT',
    target: () => U1Leaf,
    direction: Direction.OUTGOING,
    cardinality: 'one',
    enforce: 'holderId',
  })
  next: U1Leaf | undefined
}

@NodeEntity()
class U1Level2 {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  holderId: string | undefined

  @OneToOne({
    type: 'U1_NEXT',
    target: () => U1Level3,
    direction: Direction.OUTGOING,
    cardinality: 'one',
    enforce: 'holderId',
  })
  next: U1Level3 | undefined
}

@NodeEntity()
class U1Level1 {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  holderId: string | undefined

  @OneToOne({
    type: 'U1_NEXT',
    target: () => U1Level2,
    direction: Direction.OUTGOING,
    cardinality: 'one',
    enforce: 'holderId',
  })
  next: U1Level2 | undefined
}

@NodeEntity()
class U1Level0 {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  holderId: string | undefined

  @OneToOne({
    type: 'U1_NEXT',
    target: () => U1Level1,
    direction: Direction.OUTGOING,
    cardinality: 'one',
    enforce: 'holderId',
  })
  next: U1Level1 | undefined
}

// 'detach' + 'throw' variants on the same shape
@NodeEntity()
class U1DetachLevel1 {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  holderId: string | undefined

  @OneToOne({
    type: 'U1_DETACH_NEXT',
    target: () => U1Level2,
    direction: Direction.OUTGOING,
    cardinality: 'one',
    enforce: 'holderId',
    claimConflict: 'detach',
  })
  next: U1Level2 | undefined
}

@NodeEntity()
class U1ThrowLevel0 {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  holderId: string | undefined

  @OneToOne({
    type: 'U1_THROW_NEXT',
    target: () => U1Level1,
    direction: Direction.OUTGOING,
    cardinality: 'one',
    enforce: 'holderId',
    claimConflict: 'throw',
  })
  next: U1Level1 | undefined
}

// incoming direction — the comprehension must flip ends
@NodeEntity()
class U1IncomingTarget {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  holderId: string | undefined

  @OneToOne({
    type: 'U1_INCOMING',
    target: () => U1Leaf,
    direction: Direction.INCOMING,
    cardinality: 'one',
    enforce: 'holderId',
    claimConflict: 'detach',
  })
  next: U1Leaf | undefined
}

// ---- A runner that records every statement and answers scripted reads -------

class ScriptedRunner {
  readonly queries: string[] = []

  private readonly scripted: QueryOutput[] = []

  queue(output: QueryOutput): this {
    this.scripted.push(output)

    return this
  }

  queueValue(name: string, value: unknown): this {
    return this.queue({
      records: [{ get: (get: string) => (get === name ? value : undefined) }],
    } as unknown as QueryOutput)
  }

  get run(): Runner['run'] {
    return async (query: string): Promise<QueryOutput> => {
      this.queries.push(query)

      const scripted = this.scripted.shift()

      if (scripted !== undefined) {
        return scripted
      }

      // Default: the CREATE read-back (elementId per created node) and
      // empty otherwise
      return {
        records: [{ get: (name: string) => (name === INTERNAL_ID ? `elem-${this.queries.length}` : undefined) }],
      } as unknown as QueryOutput
    }
  }

  query(index: number): string {
    const query = this.queries[index]

    if (query === undefined) {
      throw new Error(`no statement #${index} — ran ${String(this.queries.length)}`)
    }

    return query
  }
}

function instance<T>(constructor: Newable, values: Record<string, unknown> = {}): T {
  const entity = new (constructor as new () => T)()

  for (const [key, value] of Object.entries(values)) {
    Reflect.set(entity, key, value)
  }

  return entity
}

const schemaOf = (constructor: Newable): EntitySchema => getModel(constructor)

// ---------------------------------------------------------------------------

describe('enforce statements — relate() (NTS-663)', () => {
  it("refuse (default): the claim guard rides the relate statement's WHERE, the SET rides the same statement", async () => {
    const runner = new ScriptedRunner()

    const person = instance(U1Level0, { id: '7e6c3c6a-0000-4000-8000-000000000001' })
    const address = instance(U1Level1, { id: '7e6c3c6a-0000-4000-8000-000000000002' })

    await new RelateService(runner).relate(
      schemaOf(U1Level0),
      person,
      address,
      schemaOf(U1Level0).getRelationship('next'),
    )

    // the NTS-161 cardinality count-guard runs first
    expect(runner.queries).toHaveLength(2)

    const statement = runner.query(1)

    expect(statement).toContain('WHERE ((to.`holderId` IS NULL OR to.`holderId` = $enforce_claim))')
    expect(statement).toContain('SET to.`holderId`')
    expect(statement).toContain('MERGE (from)-[rel:`U1_NEXT`]->(to)')
    expect(statement).not.toContain('FOREACH')
  })

  it('detach: the comprehension deletes the other claimant in the same statement, no OPTIONAL MATCH', async () => {
    const runner = new ScriptedRunner()

    const person = instance(U1DetachLevel1, { id: '7e6c3c6a-0000-4000-8000-000000000001' })
    const target = instance(U1Level2, { id: '7e6c3c6a-0000-4000-8000-000000000002' })

    await new RelateService(runner).relate(
      schemaOf(U1DetachLevel1),
      person,
      target,
      schemaOf(U1DetachLevel1).getRelationship('next'),
    )

    // the NTS-161 cardinality count-guard runs first
    expect(runner.queries).toHaveLength(2)

    const statement = runner.query(1)

    expect(statement).toContain('FOREACH (stale_claim IN [(other_claimant)-[stale_claim:U1_DETACH_NEXT]->(`to`)')
    expect(statement).toContain('DELETE stale_claim')
    expect(statement).toContain('SET to.`holderId`')
    expect(statement).not.toContain('OPTIONAL MATCH')
    expect(statement).not.toContain('IS NULL OR')
  })

  it('detach: an INCOMING relationship flips the comprehension ends', async () => {
    const runner = new ScriptedRunner()

    const person = instance(U1IncomingTarget, { id: '7e6c3c6a-0000-4000-8000-000000000001' })
    const target = instance(U1Leaf, { id: '7e6c3c6a-0000-4000-8000-000000000002' })

    await new RelateService(runner).relate(
      schemaOf(U1IncomingTarget),
      person,
      target,
      schemaOf(U1IncomingTarget).getRelationship('next'),
    )

    expect(runner.query(1)).toContain(
      'FOREACH (stale_claim IN [(`to`)<-[stale_claim:U1_INCOMING]-(other_claimant)',
    )
  })

  it('throw: a zero-row relate probes the target and fails loudly naming the claimant', async () => {
    const runner = new ScriptedRunner()

    // the guard and the relate statement consume the first two runs; the
    // probe read is third and names the current claimant
    runner.queue({ records: [] } as unknown as QueryOutput)
    runner.queue({ records: [] } as unknown as QueryOutput)
    runner.queueValue('claim_value', '7e6c3c6a-0000-4000-8000-000000000009')

    const person = instance(U1ThrowLevel0, { id: '7e6c3c6a-0000-4000-8000-000000000001' })
    const target = instance(U1Level1, { id: '7e6c3c6a-0000-4000-8000-000000000002' })

    const attempt = new RelateService(runner).relate(
      schemaOf(U1ThrowLevel0),
      person,
      target,
      schemaOf(U1ThrowLevel0).getRelationship('next'),
    )

    await expect(attempt).rejects.toThrow(/already claimed by/)
    expect(runner.queries).toHaveLength(3)
    expect(runner.query(2)).toContain('MATCH (to:U1Level1 { id: $to_id })')
    expect(runner.query(2)).toContain('RETURN to.`holderId` AS claim_value')
  })

  it('throw: a missing target keeps the undefined contract (probe finds no node)', async () => {
    const runner = new ScriptedRunner()

    // guard + relate consume the first two runs; the probe read is third
    // and finds no node — the target does not exist
    runner.queue({ records: [] } as unknown as QueryOutput)
    runner.queue({ records: [] } as unknown as QueryOutput)
    runner.queue({ records: [] } as unknown as QueryOutput)

    const person = instance(U1ThrowLevel0, { id: '7e6c3c6a-0000-4000-8000-000000000001' })
    const target = instance(U1Level1, { id: '7e6c3c6a-0000-4000-8000-000000000002' })

    const related = await new RelateService(runner).relate(
      schemaOf(U1ThrowLevel0),
      person,
      target,
      schemaOf(U1ThrowLevel0).getRelationship('next'),
    )

    expect(related).toBeUndefined()
    expect(runner.queries).toHaveLength(3)
  })
})

describe('enforce statements — the delete paths (NTS-663)', () => {
  it('hard delete: one row-preserving CALL subquery per enforce relationship', async () => {
    const runner = new ScriptedRunner()

    runner.queueValue('deleted', 1)

    const person = instance(U1Level0, { id: '7e6c3c6a-0000-4000-8000-000000000001' })

    await new DeleteService(runner).delete(schemaOf(U1Level0), person, { cascade: false })

    expect(runner.queries).toHaveLength(1)

    const statement = runner.query(0)

    expect(statement).toContain('CALL (this) {')
    expect(statement).toContain('MATCH (this)-[claim_rel:`U1_NEXT`]->(claim_target)')
    expect(statement).toContain('REMOVE claim_target.`holderId`')
    expect(statement).toContain('RETURN count(*) AS claim_removed_this_0')
    expect(statement).toContain('DETACH DELETE this')
    expect(statement).not.toContain('OPTIONAL MATCH')
  })

  it('cascade delete releases claims at EVERY level of the walk', async () => {
    const runner = new ScriptedRunner()

    runner.queueValue('deleted', 1)

    const person = instance(U1Level0, { id: '7e6c3c6a-0000-4000-8000-000000000001' })

    await new DeleteService(runner).delete(schemaOf(U1Level0), person, { cascade: true })

    const statement = runner.query(0)

    // the root plus each cascade frame: L0->L1, L1->L2, L2->L3, L3->Leaf
    const callCount = statement.split('CALL (').length - 1

    expect(callCount).toBe(4)
    expect(statement).toContain('CALL (this_next_node) {')
    expect(statement).toContain('MATCH (this_next_node)-[claim_rel:`U1_NEXT`]->(claim_target)')
    expect(statement).toContain('CALL (this_next_node_next_node) {')
    expect(statement).toContain(
      'MATCH (this_next_node_next_node)-[claim_rel:`U1_NEXT`]->(claim_target)',
    )
  })

  it('soft delete keeps the node and its claims (no CALL subqueries)', async () => {
    const runner = new ScriptedRunner()

    runner.queueValue('deleted', 1)

    const person = instance(U1Level0, { id: '7e6c3c6a-0000-4000-8000-000000000001' })

    await new DeleteService(runner).delete(schemaOf(U1Level0), person, {
      soft: 'Archived',
    })

    const statement = runner.query(0)

    expect(statement).not.toContain('CALL (')
    expect(statement).toContain('SET this:`Archived`')
  })
})

describe('enforce statements — nested creates, four levels deep (NTS-663)', () => {
  it('every level of the nested walk claims its target', async () => {
    const runner = new ScriptedRunner()

    const leaf = instance(U1Leaf, { id: '7e6c3c6a-0000-4000-8000-000000000014' })
    const level3 = instance(U1Level3, { id: '7e6c3c6a-0000-4000-8000-000000000013', next: leaf })
    const level2 = instance(U1Level2, { id: '7e6c3c6a-0000-4000-8000-000000000012', next: level3 })
    const level1 = instance(U1Level1, { id: '7e6c3c6a-0000-4000-8000-000000000011', next: level2 })
    const level0 = instance(U1Level0, { id: '7e6c3c6a-0000-4000-8000-000000000010', next: level1 })

    await createNodeAndRelationships(runner, schemaOf(U1Level0), level0)

    // one CREATE per node (5) + one relate statement per edge (4)
    expect(runner.queries).toHaveLength(9)

    const creates = runner.queries.filter((query) => query.includes('CREATE (this'))

    expect(creates).toHaveLength(5)

    const claims = runner.queries.filter((query) => query.includes('SET to.`holderId`'))

    expect(claims).toHaveLength(4)

    for (const claim of claims) {
      expect(claim).toContain('MERGE (from)-[rel:`U1_NEXT`]->(to)')
    }
  })

  it('primary-key value targets claim in the ROOT statement (NTS-627)', async () => {
    const runner = new ScriptedRunner()

    // L1 saved separately, related by pk value on the create
    await createNodeAndRelationships(runner, schemaOf(U1Level0), {
      id: '7e6c3c6a-0000-4000-8000-000000000015',
      next: '7e6c3c6a-0000-4000-8000-000000000016',
    })

    const root = runner.query(0)

    expect(root).toContain('CREATE (this')
    expect(root).toContain('SET next_0_target.`holderId`')
    expect(root).not.toContain('FOREACH')
  })
})
