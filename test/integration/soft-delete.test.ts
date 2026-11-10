import {
  NodeEntity,
  Property,
  Primary,
  Repository,
  SoftDelete,
  UpdatedAt,
  Version,
} from '../../src/index'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
@SoftDelete()
class Doc {
  @Primary()
  @Property({ type: 'string' })
  docID!: string

  @Property({ type: 'string' })
  title!: string

  static create(docID: string, title: string): Doc {
    const doc = new Doc()
    doc.docID = docID
    doc.title = title

    return doc
  }
}

@NodeEntity()
class PlainDoc {
  @Primary()
  @Property({ type: 'string' })
  docID!: string

  @Property({ type: 'string' })
  title!: string

  static create(docID: string, title: string): PlainDoc {
    const doc = new PlainDoc()
    doc.docID = docID
    doc.title = title

    return doc
  }
}

@NodeEntity()
@SoftDelete()
class VersionedDoc {
  @Primary()
  @Property({ type: 'string' })
  docID!: string

  @Property({ type: 'string' })
  title!: string

  @UpdatedAt()
  updatedAt: unknown

  @Version()
  version: number

  static create(docID: string, title: string): VersionedDoc {
    const doc = new VersionedDoc()
    doc.docID = docID
    doc.title = title

    return doc
  }
}

// ---------------------------------------------------------------------------

describe('@SoftDelete (NTS-510)', () => {
  let backend: TestBackend
  let docs: Repository<Doc>
  let plainDocs: Repository<PlainDoc>
  let versionedDocs: Repository<VersionedDoc>

  beforeAll(async () => {
    backend = await openBackend()
    docs = backend.neode.getRepository(Doc)
    plainDocs = backend.neode.getRepository(PlainDoc)
    versionedDocs = backend.neode.getRepository(VersionedDoc)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('delete stamps the label + deletedAt instead of removing the node', async () => {
    await docs.save(Doc.create('d1', 'contracts'))
    await docs.delete('d1')

    const output = await backend.neode.readCypher(
      'MATCH (d:Doc) RETURN d.docID AS id, d.deletedAt AS deletedAt',
      {},
    )

    // The node survives, labelled + stamped
    expect(output.records).toHaveLength(1)
    expect(output.records[0]?.get('id')).toBe('d1')
    expect(output.records[0]?.get('deletedAt')).toBeDefined()
  })

  it('standard reads exclude soft-deleted entities', async () => {
    await docs.save(Doc.create('d1', 'kept'))
    await docs.save(Doc.create('d2', 'gone'))
    await docs.delete('d2')

    expect(await docs.count()).toBe(1)

    const all = await docs.findAll()
    expect(all.map((doc) => doc.docID)).toEqual(['d1'])

    expect(await docs.find('d2')).toBeUndefined()
    expect(await docs.findBy({ docID: 'd2' })).toBeUndefined()
  })

  it('includeDeleted opts back in (and the facade all() stays filtered)', async () => {
    await docs.save(Doc.create('d1', 'kept'))
    await docs.save(Doc.create('d2', 'gone'))
    await docs.delete('d2')

    const including = await docs.findAll({}, { includeDeleted: true })

    expect(including).toHaveLength(2)

    // The facade delegate path stays filtered
    const viaFacade = await backend.neode.all(Doc)
    expect(viaFacade).toHaveLength(1)
  })

  it('restore removes the label + stamp; the entity reads again', async () => {
    await docs.save(Doc.create('d1', 'back'))
    await docs.delete('d1')
    expect(await docs.count()).toBe(0)

    const restored = await docs.restore('d1')

    expect(restored?.docID).toBe('d1')
    expect(await docs.count()).toBe(1)

    const raw = await backend.neode.readCypher(
      'MATCH (d:Doc { docID: "d1" }) RETURN labels(d) AS labels, d.deletedAt AS stamp',
      {},
    )

    expect(String(raw.records[0]?.get('labels'))).not.toContain('Deleted')
    expect(raw.records[0]?.get('stamp')).toBeNull()
  })

  it('force hard-deletes a soft-delete model', async () => {
    await docs.save(Doc.create('d1', 'gone forever'))
    await docs.delete('d1', { force: true })

    const output = await backend.neode.readCypher('MATCH (d:Doc) RETURN count(d) AS count', {})

    expect(Number(output.records[0]?.get('count'))).toBe(0)
  })

  it('models without @SoftDelete keep hard deletes', async () => {
    await plainDocs.save(PlainDoc.create('p1', 'real'))
    await plainDocs.delete('p1')

    const output = await backend.neode.readCypher('MATCH (d:PlainDoc) RETURN count(d) AS count', {})

    expect(Number(output.records[0]?.get('count'))).toBe(0)
  })

  it('restore throws on a model without @SoftDelete', async () => {
    await expect(plainDocs.restore('p1')).rejects.toThrow(/@SoftDelete/)
  })

  it('projection-aware reads stay filtered too', async () => {
    // Doc has no projections; the projected+filtered path is covered by
    // repository-projection.test.ts's delegation. Here: filtered findBy.
    await docs.save(Doc.create('d1', 'note'))
    await docs.delete('d1')

    expect(await docs.findBy({ title: 'note' })).toBeUndefined()
  })

  it('soft delete and restore stamp updatedAt and bump the version (NTS-604)', async () => {
    const state = async (): Promise<{ version: unknown; updatedAt: unknown }> => {
      const output = await backend.neode.readCypher(
        'MATCH (d:VersionedDoc { docID: "v1" }) RETURN d.version AS version, d.updatedAt AS updatedAt',
        {},
      )

      return {
        version: output.records[0]?.get('version'),
        updatedAt: output.records[0]?.get('updatedAt'),
      }
    }

    await versionedDocs.save(VersionedDoc.create('v1', 'state'))

    const created = await state()
    expect(Number(created.version)).toBe(0)
    expect(created.updatedAt).toBeDefined()

    await versionedDocs.delete('v1')

    // Soft delete is a write: the version moved and updatedAt re-stamped
    const deleted = await state()
    expect(Number(deleted.version)).toBe(1)
    expect(JSON.stringify(deleted.updatedAt)).not.toBe(JSON.stringify(created.updatedAt))

    // NTS-595: a repeat soft delete is a no-op — no second bump
    await versionedDocs.delete('v1')

    const repeated = await state()
    expect(Number(repeated.version)).toBe(1)
    expect(JSON.stringify(repeated.updatedAt)).toBe(JSON.stringify(deleted.updatedAt))

    const restored = await versionedDocs.restore('v1')

    // Restore is a write too: moved again
    expect(Number(restored?.version)).toBe(2)
    expect(JSON.stringify(restored?.updatedAt)).not.toBe(JSON.stringify(deleted.updatedAt))

    // And restoring a live node is a no-op — never a spurious bump
    await versionedDocs.restore('v1')

    expect(Number((await state()).version)).toBe(2)
  })
})
