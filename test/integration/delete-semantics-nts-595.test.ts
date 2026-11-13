// Delete semantics contracts (NTS-595): annotated-only cascade default,
// the cascade depth cap, node-only idempotent soft delete, and the
// deleteAll destructive guard — exercised end-to-end on the test backend.
import {
  NodeEntity,
  OneToMany,
  Primary,
  Property,
  Repository,
  SoftDelete,
  Property as StringProperty,
  testId,
} from '../../src/index'
import { openBackend, TestBackend } from './support/backend'
import { defineModel } from '../../src/meta/map-schema'
import { getModel } from '../../src/meta'
import type { Newable } from '../../src/meta/newable'
import type { SchemaDefinition } from '../../src/meta/schema-definition.interface'
import { DeleteService, MAX_CASCADE_DEPTH } from '../../src/services/query/delete.service'

// ---- Cascade fixtures (map-based; per-file registry) ------------------------

const Nts595Part = defineModel('Nts595Part', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
})

const Nts595Machine = defineModel('Nts595Machine', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  parts: {
    type: 'relationships',
    relationship: 'HAS',
    direction: 'out',
    target: 'Nts595Part',
    cascade: true,
  },
})

const Nts595Line = defineModel('Nts595Line', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  machines: {
    type: 'relationships',
    relationship: 'HAS',
    direction: 'out',
    target: 'Nts595Machine',
    cascade: true,
  },
})

const Nts595Warehouse = defineModel('Nts595Warehouse', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
})

const Nts595Factory = defineModel('Nts595Factory', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  lines: {
    type: 'relationships',
    relationship: 'HAS',
    direction: 'out',
    target: 'Nts595Line',
    cascade: true,
  },
  // Unannotated: survives an annotated-only delete, node detached
  warehouse: {
    type: 'relationship',
    relationship: 'HAS',
    direction: 'out',
    target: 'Nts595Warehouse',
  },
})

// Self-referential chain: every hop annotated, so the depth cap bounds it
const Nts595Chain = defineModel('Nts595Chain', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  child: {
    type: 'relationship',
    relationship: 'NEXT',
    direction: 'out',
    target: 'Nts595Chain',
    cascade: true,
  },
})

// Shared targets: two independent roots cascading onto the same node
const Nts595Shared = defineModel('Nts595Shared', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
})

const Nts595RootA = defineModel('Nts595RootA', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  link: {
    type: 'relationship',
    relationship: 'A',
    direction: 'out',
    target: 'Nts595Shared',
    cascade: true,
  },
})

const Nts595RootB = defineModel('Nts595RootB', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  link: {
    type: 'relationship',
    relationship: 'B',
    direction: 'out',
    target: 'Nts595Shared',
    cascade: true,
  },
})

// ---- Soft delete + deleteAll fixtures (decorators) --------------------------

@NodeEntity()
@SoftDelete()
class Nts595Doc {
  @Primary()
  @Property({ type: 'string' })
  docID!: string

  @StringProperty()
  title!: string

  @OneToMany(() => Nts595Tag, 'TAGGED', 'OUT', undefined, undefined, true)
  tags!: Nts595Tag[]
}

@NodeEntity()
class Nts595Tag {
  @Primary()
  @Property({ type: 'string' })
  tagID!: string
}

// ---------------------------------------------------------------------------

describe('delete semantics (NTS-595)', () => {
  let backend: TestBackend
  let deleteService: DeleteService
  let docs: Repository<Nts595Doc>

  const count = async (label: string, property: string, value: string): Promise<number> => {
    const res = await backend.neode.readCypher(
      'MATCH (n:' + label + ' { ' + property + ': $value }) RETURN count(n) AS c',
      { value },
    )

    return Number(res.records[0]?.get('c') ?? 0)
  }

  /** The primary key of a node, looked up by its unique name */
  const idOf = async (label: string, name: string): Promise<string> => {
    const res = await backend.neode.readCypher(
      'MATCH (n:' + label + ' { name: $name }) RETURN n.id AS id',
      { name },
    )

    return String(res.records[0]?.get('id'))
  }

  beforeAll(async () => {
    backend = await openBackend()
    deleteService = new DeleteService(backend.connection)
    docs = backend.neode.getRepository(Nts595Doc)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('annotated-only cascade: the annotated chain is deleted, the unannotated warehouse survives', async () => {
    const Factory = Nts595Factory as unknown as Newable
    const Line = Nts595Line as unknown as Newable
    const Machine = Nts595Machine as unknown as Newable
    const Part = Nts595Part as unknown as Newable
    const Warehouse = Nts595Warehouse as unknown as Newable

    const part = new Part() as unknown as { name: string }
    part.name = 'Part 1'

    const machine = new Machine() as unknown as { name: string; parts: unknown[] }
    machine.name = 'Machine 1'
    machine.parts = [part]

    const line = new Line() as unknown as { name: string; machines: unknown[] }
    line.name = 'Line 1'
    line.machines = [machine]

    const warehouse = new Warehouse() as unknown as { name: string }
    warehouse.name = 'Warehouse 1'

    const factory = new Factory() as unknown as {
      name: string
      lines: unknown[]
      warehouse: unknown
    }
    factory.name = 'Factory 1'
    factory.lines = [line]
    factory.warehouse = warehouse

    await backend.neode.save(factory)

    await deleteService.delete(getModel(Nts595Factory), {
      id: await idOf('Nts595Factory', 'Factory 1'),
    })

    // The annotated chain is gone
    expect(await count('Nts595Factory', 'name', 'Factory 1')).toBe(0)
    expect(await count('Nts595Line', 'name', 'Line 1')).toBe(0)
    expect(await count('Nts595Machine', 'name', 'Machine 1')).toBe(0)
    expect(await count('Nts595Part', 'name', 'Part 1')).toBe(0)

    // The unannotated warehouse survives — detached, not deleted
    expect(await count('Nts595Warehouse', 'name', 'Warehouse 1')).toBe(1)

    const edges = await backend.neode.readCypher(
      'MATCH (:Nts595Factory)-[:`HAS`]->(:Nts595Warehouse) RETURN count(*) AS c',
    )
    expect(Number(edges.records[0]?.get('c'))).toBe(0)
  })

  it('a self-referential cascade stops at the depth cap', async () => {
    // A chain of MAX_CASCADE_DEPTH + 3 nodes: the walk must delete the
    // root and the first MAX_CASCADE_DEPTH hops and leave the tail standing
    const Chain = Nts595Chain as unknown as Newable
    const total = MAX_CASCADE_DEPTH + 3

    const build = (index: number): unknown => {
      if (index > total) {
        return undefined
      }

      const node = new Chain() as unknown as { name: string; child?: unknown }
      node.name = `Link ${index}`
      node.child = build(index + 1)

      return node
    }

    await backend.neode.save(build(1))

    await deleteService.delete(getModel(Nts595Chain), {
      id: await idOf('Nts595Chain', 'Link 1'),
    })

    // Root + MAX_CASCADE_DEPTH children deleted
    for (let index = 1; index <= MAX_CASCADE_DEPTH + 1; index += 1) {
      expect(await count('Nts595Chain', 'name', `Link ${index}`)).toBe(0)
    }

    // The tail beyond the cap survives
    for (let index = MAX_CASCADE_DEPTH + 2; index <= total; index += 1) {
      expect(await count('Nts595Chain', 'name', `Link ${index}`)).toBe(1)
    }
  })

  it('shared cascade targets are deleted once, and later deletes of the other root succeed', async () => {
    const RootA = Nts595RootA as unknown as Newable
    const RootB = Nts595RootB as unknown as Newable
    const Shared = Nts595Shared as unknown as Newable

    for (const [Ctor, name] of [
      [Shared, 'Shared 1'],
      [RootA, 'Root A'],
      [RootB, 'Root B'],
    ] as const) {
      const node = new Ctor() as unknown as { name: string }
      node.name = name

      await backend.neode.save(node)
    }

    // Both roots cascade onto the SAME shared node
    await backend.neode.writeCypher(
      'MATCH (a:Nts595RootA { name: "Root A" }), (s:Nts595Shared { name: "Shared 1" }) CREATE (a)-[:`A`]->(s)',
    )
    await backend.neode.writeCypher(
      'MATCH (b:Nts595RootB { name: "Root B" }), (s:Nts595Shared { name: "Shared 1" }) CREATE (b)-[:`B`]->(s)',
    )

    await deleteService.delete(getModel(Nts595RootA), {
      id: await idOf('Nts595RootA', 'Root A'),
    })

    expect(await count('Nts595RootA', 'name', 'Root A')).toBe(0)
    expect(await count('Nts595Shared', 'name', 'Shared 1')).toBe(0)
    expect(await count('Nts595RootB', 'name', 'Root B')).toBe(1)

    // The second root's cascade runs against the already-deleted target
    // and must complete without error
    await deleteService.delete(getModel(Nts595RootB), {
      id: await idOf('Nts595RootB', 'Root B'),
    })

    expect(await count('Nts595RootB', 'name', 'Root B')).toBe(0)
  })

  it('soft delete is node-only and idempotent — a repeat never re-stamps deletedAt', async () => {
    const tag = new Nts595Tag()
    tag.tagID = testId('tag')

    const doc = new Nts595Doc()
    doc.docID = testId('doc')
    doc.title = 'contracts'
    doc.tags = [tag]

    await docs.save(doc)

    const rawStamp = async (id: string) => {
      const res = await backend.neode.readCypher(
        'MATCH (d:Nts595Doc { docID: $id }) RETURN d.deletedAt AS deletedAt',
        { id },
      )

      return res.records[0]?.get('deletedAt')
    }

    await docs.delete(doc.docID)

    const firstStamp = await rawStamp(doc.docID)
    expect(firstStamp).toBeDefined()

    // The node survives with its relationships untouched
    const edges = await backend.neode.readCypher(
      'MATCH (:Nts595Doc)-[:`TAGGED`]->(:Nts595Tag) RETURN count(*) AS c',
    )
    expect(Number(edges.records[0]?.get('c'))).toBe(1)

    // Repeat: still exactly one node, stamp unchanged
    await docs.delete(doc.docID)

    const nodes = await backend.neode.readCypher(
      'MATCH (d:Nts595Doc { docID: $id }) RETURN count(d) AS c',
      { id: doc.docID },
    )
    expect(Number(nodes.records[0]?.get('c'))).toBe(1)
    expect(await rawStamp(doc.docID)).toEqual(firstStamp)
  })

  it('deleteAll refuses an unfiltered call and wipes only when confirmed', async () => {
    const keep = new Nts595Doc()
    keep.docID = testId('doc-keep')
    keep.title = 'keep'

    const drop = new Nts595Doc()
    drop.docID = testId('doc-drop')
    drop.title = 'drop'

    await docs.save(keep)
    await docs.save(drop)

    await expect(docs.deleteAll()).rejects.toThrow(/deleteAll\(\) refused on Nts595Doc/)
    await expect(docs.deleteAll()).rejects.toThrow(/\{ all: true \}/)
    await expect(docs.deleteAll({})).rejects.toThrow()

    // Nothing was deleted by the refused calls
    expect(
      (await count('Nts595Doc', 'title', 'keep')) + (await count('Nts595Doc', 'title', 'drop')),
    ).toBe(2)

    // A filtered call deletes only its subset
    expect(await docs.deleteAll({ title: 'drop' })).toBe(1)
    expect(await count('Nts595Doc', 'title', 'keep')).toBe(1)

    // The confirmed wipe takes everything
    expect(await docs.deleteAll({ all: true })).toBe(1)
    expect(await count('Nts595Doc', 'title', 'keep')).toBe(0)
  })
})
