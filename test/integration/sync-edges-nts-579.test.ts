// NTS-579 — syncEdges hardening: targets are verified before any edge is
// detached, edges are matched by elementId (driver Integer keys, labels),
// and the detach scan is anchored on the from-node.
import { openBackend, TestBackend } from './support/backend'
import { NodeEntity, OneToMany, Primary, Property, Uuid } from '../../src/decorators'
import { Direction } from '../../src/query'
import { NeodeError } from '../../src/errors'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Nts579Item {
  // Numeric primary key: stored as an integer, read back as a driver Integer
  @Primary()
  @Property({ type: 'number' })
  num!: number

  @Property({ type: 'string' })
  name!: string
}

// Same primary-key value and property name as Nts579Item, different label
@NodeEntity()
class Nts579Other {
  @Primary()
  @Property({ type: 'number' })
  num!: number
}

@NodeEntity()
class Nts579Holder {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string', unique: true })
  name!: string

  @OneToMany(() => Nts579Item, 'HAS_ITEM', Direction.OUTGOING)
  items!: Nts579Item[]
}

const item = (num: number): Nts579Item => Object.assign(new Nts579Item(), { num })

describe('syncEdges (NTS-579)', () => {
  let backend: TestBackend
  let holder: Nts579Holder

  const itemNums = async (): Promise<number[]> => {
    const result = await backend.neode.readCypher(
      'MATCH (:Nts579Holder { name: "H" })-[:HAS_ITEM]->(i) RETURN toInteger(i.num) AS num ORDER BY num',
    )

    return result.records.map((row) => Number(row.get('num')))
  }

  beforeAll(async () => {
    backend = await openBackend()
  })

  beforeEach(async () => {
    await backend.clearGraph()

    holder = await backend.neode.save(Object.assign(new Nts579Holder(), { name: 'H' }))

    // Seeded with Cypher integer literals so the keys are stored as integers
    await backend.neode.writeCypher(
      'MATCH (h:Nts579Holder { name: "H" }) ' +
        'CREATE (h)-[:HAS_ITEM { weight: 7 }]->(:Nts579Item { num: 1, name: "one" }) ' +
        'CREATE (:Nts579Item { num: 2, name: "two" })',
    )
  })

  afterAll(async () => {
    await backend.clearGraph()
    await backend.close()
  })

  it('a target missing from the database fails without deleting existing edges', async () => {
    const attempt = backend.neode.syncEdges(Nts579Holder, holder, 'items', [item(2), item(99)])

    await expect(attempt).rejects.toBeInstanceOf(NeodeError)
    await expect(attempt).rejects.toThrow(/Nts579Item with num = 99/)
    await expect(attempt).rejects.toThrow(/Save the missing targets first/)

    // The stale edge (num 1) survived and nothing was attached
    expect(await itemNums()).toEqual([1])
  })

  it('an Integer primary key keeps the wanted edge and its properties', async () => {
    const result = await backend.neode.syncEdges(Nts579Holder, holder, 'items', [item(1), item(2)])

    expect(result).toEqual({ attached: 1, detached: 0 })
    expect(await itemNums()).toEqual([1, 2])

    const weights = await backend.neode.readCypher(
      'MATCH (:Nts579Holder { name: "H" })-[r:HAS_ITEM]->(i:Nts579Item { num: 1 }) RETURN r.weight AS weight',
    )

    expect(Number(weights.records[0]?.get('weight'))).toBe(7)
  })

  it('a different-label node with the same primary key does not count as matched', async () => {
    await backend.neode.writeCypher(
      'MATCH (:Nts579Holder { name: "H" })-[r:HAS_ITEM]->(:Nts579Item { num: 1 }) DELETE r ' +
        'WITH 1 AS x MATCH (h:Nts579Holder { name: "H" }) ' +
        'CREATE (h)-[:HAS_ITEM]->(:Nts579Other { num: 1 })',
    )

    const result = await backend.neode.syncEdges(Nts579Holder, holder, 'items', [item(1)])

    // The Other node's edge is stale; the Item with num 1 is newly related
    expect(result).toEqual({ attached: 1, detached: 1 })

    const labels = await backend.neode.readCypher(
      'MATCH (:Nts579Holder { name: "H" })-[:HAS_ITEM]->(i) RETURN labels(i) AS labels',
    )

    expect(labels.records).toHaveLength(1)
    expect(labels.records[0]?.get('labels')).toEqual(['Nts579Item'])
  })

  it('does not touch another node’s edges of the same type', async () => {
    await backend.neode.writeCypher(
      'MATCH (i:Nts579Item { num: 2 }) CREATE (:Nts579Holder { name: "Bystander" })-[:HAS_ITEM]->(i)',
    )

    await backend.neode.syncEdges(Nts579Holder, holder, 'items', [item(2)])

    const bystander = await backend.neode.readCypher(
      'MATCH (:Nts579Holder { name: "Bystander" })-[r:HAS_ITEM]->() RETURN count(r) AS c',
    )

    expect(Number(bystander.records[0]?.get('c'))).toBe(1)
    expect(await itemNums()).toEqual([2])
  })
})
