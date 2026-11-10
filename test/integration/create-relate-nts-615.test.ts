/**
NTS-615: eager relationship creation on the write path — create() /
update() accept `options.relate` (relationship key -> saved target) and
relate inside the same managed transaction as the write. A failure
mid-write leaves no orphan node: the edges and the node commit or roll
back together. Edges are MERGE-based, so retries stay idempotent (the
same guarantee relate() gives).
*/
import { openBackend, TestBackend } from './support/backend'
import { EventType, QueryExecutedEvent } from '../../src/common/events'
import { NodeEntity, OneToMany, Property, Uuid } from '../../src/decorators'
import { Direction } from '../../src/query'
import { CardinalityViolationError } from '../../src/errors'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Team {
  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string
}

@NodeEntity()
class Person {
  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string

  @OneToMany(() => Team, 'PART_OF', Direction.OUTGOING)
  team: Team
}

// A single-edge relationship: a second eager target must be refused
@NodeEntity()
class Badge {
  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string
}

@NodeEntity()
class Wearer {
  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string

  @OneToMany(() => Badge, 'WEARS', Direction.OUTGOING, undefined, undefined, undefined, 'one')
  badge: Badge
}

describe('eager relates on create() and update() (NTS-615)', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('relates eager targets in the same transaction as the create', async () => {
    const team = await backend.neode.create(Team, { name: 'Engineering' })

    const created = await backend.neode.create(Person, { name: 'Adam' }, { relate: { team } })

    expect(created).toBeInstanceOf(Person)
    expect(created.name).toBe('Adam')

    const edges = await backend.neode.readCypher(
      'MATCH (p:Person { name: $name })-[r:PART_OF]->(t:Team) RETURN t.name AS team',
      { name: 'Adam' },
    )

    expect(edges.records).toHaveLength(1)
    expect(edges.records[0].get('team')).toBe('Engineering')
  })

  it('accepts an array of targets on a many relationship', async () => {
    const first = await backend.neode.create(Team, { name: 'First' })
    const second = await backend.neode.create(Team, { name: 'Second' })

    await backend.neode.create(Person, { name: 'Adam' }, { relate: { team: [first, second] } })

    const edges = await backend.neode.readCypher(
      'MATCH (:Person { name: $name })-[r:PART_OF]->(t:Team) RETURN count(r) AS edges',
      { name: 'Adam' },
    )

    expect(Number(edges.records[0].get('edges'))).toBe(2)
  })

  it('renders the edge as MERGE — relating the same target twice writes one edge', async () => {
    const team = await backend.neode.create(Team, { name: 'Engineering' })

    const created = await backend.neode.create(Person, { name: 'Adam' })

    await backend.neode.update(created, { name: 'Adam' }, { relate: { team } })
    await backend.neode.update(created, { name: 'Adam' }, { relate: { team } })

    const edges = await backend.neode.readCypher(
      'MATCH (:Person { name: $name })-[r:PART_OF]->() RETURN count(r) AS edges',
      { name: 'Adam' },
    )

    expect(Number(edges.records[0].get('edges'))).toBe(1)
  })

  it('a failure mid-write leaves no orphan node (unknown relationship key)', async () => {
    const team = await backend.neode.create(Team, { name: 'Engineering' })

    await expect(
      backend.neode.create(Person, { name: 'Adam' }, { relate: { nonexistent: team } }),
    ).rejects.toThrow(/relationship/i)

    const people = await backend.neode.readCypher(
      'MATCH (p:Person { name: $name }) RETURN count(p) AS people',
      { name: 'Adam' },
    )

    // The create rolled back with its failed eager relate
    expect(Number(people.records[0].get('people'))).toBe(0)
  })

  it('a cardinality violation mid-write leaves no orphan node and no partial edge', async () => {
    const first = await backend.neode.create(Badge, { name: 'Gold' })
    const second = await backend.neode.create(Badge, { name: 'Silver' })

    await expect(
      backend.neode.create(Wearer, { name: 'Adam' }, { relate: { badge: [first, second] } }),
    ).rejects.toThrow(CardinalityViolationError)

    const wearers = await backend.neode.readCypher(
      'MATCH (w:Wearer) RETURN count(w) AS wearers',
      {},
    )

    const edges = await backend.neode.readCypher(
      'MATCH ()-[e:WEARS]->() RETURN count(e) AS edges',
      {},
    )

    expect(Number(wearers.records[0].get('wearers'))).toBe(0)
    expect(Number(edges.records[0].get('edges'))).toBe(0)
  })

  it('relates eager targets in the same transaction as the update', async () => {
    const team = await backend.neode.create(Team, { name: 'Engineering' })

    const created = await backend.neode.create(Person, { name: 'Adam' })

    const updated = await backend.neode.update(created, { name: 'Adam' }, { relate: { team } })

    expect(updated).toBeInstanceOf(Person)

    const edges = await backend.neode.readCypher(
      'MATCH (:Person { name: $name })-[r:PART_OF]->(t:Team) RETURN t.name AS team',
      { name: 'Adam' },
    )

    expect(edges.records).toHaveLength(1)
    expect(edges.records[0].get('team')).toBe('Engineering')
  })

  it('the eager edge is one MERGE statement inside the create transaction', async () => {
    const events: QueryExecutedEvent[] = []

    backend.neode.on(EventType.QUERY_EXECUTED, (event) => events.push(event as QueryExecutedEvent))

    const team = await backend.neode.create(Team, { name: 'Engineering' })

    events.length = 0

    await backend.neode.create(Person, { name: 'Adam' }, { relate: { team } })

    const edgeStatements = events
      .map((event) => event.cypher)
      .filter((cypher) => cypher.includes('PART_OF'))

    expect(edgeStatements).toHaveLength(1)
    expect(edgeStatements[0]).toContain('MERGE (from)-[rel:`PART_OF`]->(to)')
    expect(edgeStatements[0]).toContain('WHERE (elementId(from) = $')
  })
})
