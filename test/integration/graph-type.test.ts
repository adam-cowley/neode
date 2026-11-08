// support/backend first: it initialises neode.service, breaking the
// utils <-> neode.service circular init that would otherwise surface
// when this file's service imports are evaluated first.
import { openBackend, type TestBackend } from './support/backend'
import { Neode } from '../../src/neode.service'
import {
  EndNode,
  NodeEntity,
  OneToOne,
  Property,
  RelationshipEntity,
  StartNode,
} from '../../src/decorators'
import { Direction } from '../../src/query/direction'

/**
 * Graph type install/drop against a real server (NTS-548). Graph types are
 * Enterprise Edition + Neo4j 2026.02+ — probed locally (SHOW CURRENT GRAPH
 * TYPE) instead of a shared capability, so unsupported backends just skip.
 */

@NodeEntity()
class GtMovie {
  @Property({ type: 'string' })
  title!: string

  @Property({ type: 'int' })
  released!: number
}

@RelationshipEntity()
class GtActedIn {
  @Property({ type: 'int' })
  billing!: number

  @StartNode(() => GtMovie)
  source!: GtMovie

  @EndNode(() => GtMovie)
  target!: GtMovie
}

@NodeEntity()
class GtActor {
  @Property({ type: 'string' })
  name!: string

  @OneToOne({ type: 'GT_ACTED_IN', target: () => GtActedIn, direction: Direction.OUTGOING })
  actedIn!: GtActedIn
}

@NodeEntity()
class GtPerson {
  @Property({ type: 'string', required: true })
  name!: string
}

let backend: TestBackend
let supportsGraphTypes = false

beforeAll(async () => {
  backend = await openBackend()

  try {
    await backend.connection.run('SHOW CURRENT GRAPH TYPE')

    supportsGraphTypes = true
  } catch {
    supportsGraphTypes = false
  }
})

afterAll(async () => {
  if (supportsGraphTypes) {
    // Self-cleaning: drop the graph type and the test nodes
    await new Neode(backend.connection, true).dropGraphType().catch(() => undefined)
  }

  await backend.clearGraph()
  await backend.close()
})

const shownGraphType = async (): Promise<string> => {
  const output = await backend.connection.run('SHOW CURRENT GRAPH TYPE', {}, 'READ')

  return output.records
    .map((record) => record.keys.map((key) => `${record.get(key)}`).join(' | '))
    .join('\n')
}

describe('graph types (NTS-548)', () => {
  it('installs the model-derived graph type, enforces it, and drops it', async () => {
    if (!supportsGraphTypes) {
      return
    }

    const neode = new Neode(backend.connection, true)

    const installed = await neode.installGraphType()

    expect(installed).toHaveLength(1)
    expect(installed[0]?.success).toBe(true)
    expect(installed[0]?.statement.startsWith('ALTER CURRENT GRAPH TYPE SET {')).toBe(true)

    const shown = await shownGraphType()

    expect(shown).toContain('GtPerson')
    expect(shown).toContain('GtMovie')
    expect(shown).toContain('GT_ACTED_IN')

    // Compliant data passes...
    await backend.connection.run("CREATE (:GtMovie { title: 'Cloak', released: 2026 })")

    // ...violating data (wrong property type) is rejected by the server
    await expect(backend.connection.run('CREATE (:GtMovie { title: 2026 })')).rejects.toThrow()

    // ...and relationship element types enforce entity properties + ends
    await backend.connection.run("CREATE (:GtActor { name: 'Test Actor' })")

    await expect(
      backend.connection.run(
        "MATCH (a:GtActor), (m:GtMovie) CREATE (a)-[:GT_ACTED_IN { billing: 'many' }]->(m)",
      ),
    ).rejects.toThrow()

    const dropped = await neode.dropGraphType()

    expect(dropped[0]?.success).toBe(true)
    expect(dropped[0]?.statement.startsWith('ALTER CURRENT GRAPH TYPE DROP {')).toBe(true)

    // With the graph type dropped, the violating write is accepted again
    await backend.connection.run('CREATE (:GtMovie { title: 2026 })')
  })

  it('reports a failed result instead of running without the enterprise flag', async () => {
    // Client-side gate: never touches the server, works on any backend
    const community = new Neode(backend.connection, false)
    const results = await community.installGraphType()

    expect(results[0]?.success).toBe(false)
    expect(results[0]?.error?.message).toContain('Enterprise')
  })

  it('installs named constraints on non-identifying labels (NTS-549)', async () => {
    if (!supportsGraphTypes) {
      return
    }

    const neode = new Neode(backend.connection, true)

    // GtMovie is an element type; GtOrphan is constrained without being one
    const installed = await neode.installGraphType({
      constraints: [
        {
          name: 'gt_orphan_tag_unique',
          labelOrType: 'GtOrphan',
          properties: ['tag'],
          kind: 'UNIQUE',
        },
      ],
    })

    expect(installed[0]?.success).toBe(true)

    const shown = await shownGraphType()

    expect(shown).toContain('gt_orphan_tag_unique')

    // The named constraint enforces: create one node, then a duplicate fails
    await backend.connection.run("CREATE (:GtOrphan { tag: 'one' })")
    await expect(backend.connection.run("CREATE (:GtOrphan { tag: 'one' })")).rejects.toThrow()

    // The name is addressable in DROP CONSTRAINT
    await backend.connection.run('DROP CONSTRAINT gt_orphan_tag_unique')

    await neode.dropGraphType()
  })
})
