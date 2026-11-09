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
import { formatSchemaDrift, schemaDrift } from '../../src/services/schema/drift.service'

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

@NodeEntity()
class Nts552Install {
  @Property({ type: 'int', unique: ['region', 'code'] })
  code!: number

  @Property({ type: 'string' })
  region!: string
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
    expect(installed[0]?.statement.startsWith('ALTER CURRENT GRAPH TYPE ADD {')).toBe(true)

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

    // Earlier tests leave data that violates the element types — a SET
    // against a populated database fails on conflicting nodes
    await backend.clearGraph()

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

  it('installs composite REQUIRE constraints from model flags (NTS-552)', async () => {
    if (!supportsGraphTypes) {
      return
    }

    const neode = new Neode(backend.connection, true)

    await backend.clearGraph()

    // Nts552Install is declared with a composite unique over two properties
    // (see the model below); the server canonicalises it to a named
    // CONSTRAINT ... REQUIRE (...) IS UNIQUE item
    const installed = await neode.installGraphType()

    expect(installed[0]?.success).toBe(true)

    const shown = await shownGraphType()

    expect(shown).toContain('nts552install_code_region_unique_47b9fbe9')

    // Enforcement: the composite pair must be unique (existence of the KEY
    // half is server-dependent — real Neo4j enforces it, the embedded
    // engine only enforces uniqueness)
    await backend.connection.run("CREATE (:Nts552Install { code: 1, region: 'EU' })")
    await expect(
      backend.connection.run("CREATE (:Nts552Install { code: 1, region: 'EU' })"),
    ).rejects.toThrow()

    await neode.dropGraphType()
  })

  it('extends and alters the installed graph type (NTS-551)', async () => {
    if (!supportsGraphTypes) {
      return
    }

    const neode = new Neode(backend.connection, true)

    await backend.clearGraph()

    await neode.installGraphType()

    // ADD: a new element type (declared on a registered model installed
    // after the first SET — here simulated by extending with a hand-built
    // definition, the same shape deriveGraphType produces)
    const extended = await neode.extendGraphType({
      nodes: [{ label: 'GtStudio', properties: [{ name: 'name', type: 'STRING' }] }],
      relationships: [
        {
          type: 'GT_PRODUCED',
          source: 'GtStudio',
          target: 'GtMovie',
          properties: [{ name: 'year', type: 'INTEGER' }],
        },
      ],
    })

    expect(extended[0]?.success).toBe(true)
    expect(extended[0]?.statement.startsWith('ALTER CURRENT GRAPH TYPE ADD {')).toBe(true)

    expect(await shownGraphType()).toContain('GtStudio')

    // ALTER: redefine an existing element type (uniqueness stripped —
    // key/uniqueness constraints remain unchanged server-side)
    const altered = await neode.alterGraphType({
      nodes: [
        { label: 'GtMovie', properties: [{ name: 'title', type: 'STRING', nullable: false }] },
      ],
    })

    expect(altered[0]?.success).toBe(true)
    expect(altered[0]?.statement.startsWith('ALTER CURRENT GRAPH TYPE ALTER {')).toBe(true)

    // The altered element type is enforced: a GtMovie without title fails
    await expect(backend.connection.run('CREATE (:GtMovie { released: 2026 })')).rejects.toThrow()

    await neode.dropGraphType()
  })

  it('reports graph type drift and wipe() resets the graph type (NTS-550)', async () => {
    if (!supportsGraphTypes) {
      return
    }

    const neode = new Neode(backend.connection, true)

    await backend.clearGraph()

    // Earlier tests leave element types behind: replace so the drift is measured from a clean graph type
    await neode.installGraphType({ replace: true, canDropUndeclared: true })

    // Freshly installed from the same derivation: no graph type drift
    const clean = await schemaDrift(backend.connection)

    expect(clean.graphType).toBeDefined()
    expect(clean.graphType?.missing).toEqual([])
    expect(clean.graphType?.stale).toEqual([])
    expect(clean.graphType?.mismatched).toEqual([])

    // Drift arrives the moment the server's graph type differs from the
    // models: drop an installed element type behind the library's back
    // (Nts552Install — un-referenced by relationship element types, which
    // would have to be dropped or altered first)
    await backend.connection.run('ALTER CURRENT GRAPH TYPE DROP {(:`Nts552Install` =>)}')

    const drifted = await schemaDrift(backend.connection)

    expect(drifted.graphType?.missing.map((entry) => entry.name)).toContain('Nts552Install')
    expect(drifted.graphType?.missing[0]?.createStatement).toContain('ADD {(:`Nts552Install`')

    // The report mentions the family
    expect(formatSchemaDrift(drifted)).toContain('graph type')

    // wipe() resets the graph type to empty (and every constraint with it)
    const { wipe } = await import('../../src/testing/wipe.js')

    await wipe(neode, { confirm: true })

    const after = await schemaDrift(backend.connection)

    // Everything declared is missing again — the graph type is gone
    expect(after.graphType?.installed).toBeUndefined()
    expect(after.graphType?.missing.map((entry) => entry.name)).toContain('GtPerson')

    await backend.clearGraph()
  })

  it('does not drop foreign graph type objects unless replace is requested (NTS-578)', async () => {
    if (!supportsGraphTypes) {
      return
    }

    const neode = new Neode(backend.connection, true)

    await backend.clearGraph()
    await neode.dropGraphType().catch(() => undefined)

    // Another application's element type + constraint on the shared database
    await backend.connection.run(
      'ALTER CURRENT GRAPH TYPE ADD {(:`Nts578Foreign` => {`id` :: STRING NOT NULL})}',
    )
    await backend.connection.run(
      'ALTER CURRENT GRAPH TYPE ADD {CONSTRAINT nts578_foreign_id_unique FOR (n:`Nts578Foreign`) REQUIRE (n.`id`) IS UNIQUE}',
    )

    const installed = await neode.installGraphType()

    expect(installed.every((result) => result.success)).toBe(true)

    const shown = await shownGraphType()

    expect(shown).toContain('Nts578Foreign')
    expect(shown).toContain('nts578_foreign_id_unique')
    expect(shown).toContain('GtPerson')

    // Idempotent: nothing left to add, nothing rewritten
    const again = await neode.installGraphType()

    expect(again.every((result) => result.success)).toBe(true)
    expect(await shownGraphType()).toContain('Nts578Foreign')

    // replace: true is refused while it would drop the foreign objects...
    const refused = await neode.installGraphType({ replace: true })

    expect(refused[0]?.success).toBe(false)
    expect(refused[0]?.error?.message).toContain('Nts578Foreign')
    expect(await shownGraphType()).toContain('Nts578Foreign')

    // ...and replaces the whole graph type only when explicitly allowed
    const replaced = await neode.installGraphType({ replace: true, canDropUndeclared: true })

    expect(replaced[0]?.success).toBe(true)
    expect(replaced[0]?.statement.startsWith('ALTER CURRENT GRAPH TYPE SET {')).toBe(true)
    expect(await shownGraphType()).not.toContain('Nts578Foreign')

    await neode.dropGraphType()
    await backend.clearGraph()
  })
})
