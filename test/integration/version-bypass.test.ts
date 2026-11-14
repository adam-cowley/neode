// The backend import loads neode.service first, resolving the
// query.service -> utils -> neode.service module cycle before the
// query services below are evaluated
import { openBackend, TestBackend } from './support/backend'
import { setDefaultNeode } from '../../src/entity-methods'
import {
  CreatedAt,
  InternalId,
  NodeEntity,
  Number,
  Readonly,
  Required,
  Property,
  Uuid,
  Version,
} from '../../src/decorators'
import { OptimisticLockError } from '../../src/errors'
import { getModel } from '../../src/meta'
import { BulkService } from '../../src/services/query/bulk.service'

// ---- Fixtures (per-file: decorator registry is global per module) -----------

@NodeEntity()
class GuardedDoc {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  @Required()
  title: string

  @Property({ type: 'string' })
  @Readonly()
  species: string

  @Number()
  counter: number

  @CreatedAt()
  createdAt: unknown

  @Version()
  version: number
}

// ---------------------------------------------------------------------------

describe('@Version bypass paths (NTS-580)', () => {
  let backend: TestBackend

  const readNode = async (id: string): Promise<Record<string, unknown>> => {
    const output = await backend.neode.readCypher(
      'MATCH (n:GuardedDoc {id: $id}) RETURN n.version AS version, n.title AS title, n.species AS species, toString(n.createdAt) AS createdAt',
      { id },
    )

    const record = output.records[0]

    if (record === undefined) {
      throw new Error(`GuardedDoc ${id} not found`)
    }

    return Object.fromEntries(record.keys.map((key) => [key, record.get(key)]))
  }

  beforeAll(async () => {
    backend = await openBackend()

    setDefaultNeode(backend.neode)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('an untracked save with a stale version conflicts instead of resetting the counter', async () => {
    const doc = await backend.neode.create(GuardedDoc, { title: 'Home' })

    // Another writer moves the node to version 1
    doc['title'] = 'About'
    await doc.save()

    const dto = (): GuardedDoc =>
      Object.assign(new GuardedDoc(), { id: doc.id, title: 'Stale', version: 0 })

    await expect(backend.neode.save(dto())).rejects.toThrow(OptimisticLockError)

    // The failed save changed nothing: still version 1 with the newer title
    expect(await readNode(doc.id)).toMatchObject({ version: 1, title: 'About' })
  })

  it('an untracked save with the current version bumps once, and a replay conflicts', async () => {
    const doc = await backend.neode.create(GuardedDoc, { title: 'Home' })

    const dto = (): GuardedDoc =>
      Object.assign(new GuardedDoc(), { id: doc.id, title: 'Edited', version: 0 })

    await backend.neode.save(dto())

    // N -> N+1, not N -> N+1 -> N
    expect(await readNode(doc.id)).toMatchObject({ version: 1, title: 'Edited' })

    await expect(backend.neode.save(dto())).rejects.toThrow(OptimisticLockError)

    expect(await readNode(doc.id)).toMatchObject({ version: 1 })
  })

  it('an untracked save of a new node (no match) creates it at version 0', async () => {
    const created = await backend.neode.save(
      Object.assign(new GuardedDoc(), {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Fresh',
        version: 7,
      }),
    )

    expect(await readNode(created.id)).toMatchObject({ version: 0, title: 'Fresh' })
  })

  it('a failed validation does not bump the version', async () => {
    const doc = await backend.neode.create(GuardedDoc, { title: 'Home' })

    doc['title'] = undefined as unknown as string
    doc['counter'] = 'not-a-number' as unknown as number

    await expect(doc.save()).rejects.toThrow()

    expect(await readNode(doc.id)).toMatchObject({ version: 0, title: 'Home' })
  })

  describe('repository.patch', () => {
    it('rejects version, primary key, readonly and createdAt with a fix-suggesting error', async () => {
      const repository = backend.neode.getRepository(GuardedDoc)
      const doc = await backend.neode.create(GuardedDoc, { title: 'Home', species: 'cat' })

      await expect(repository.patch(doc, { version: 99 })).rejects.toThrow(
        /@Version.*Remove "version"/,
      )
      await expect(repository.patch(doc, { id: 'other' })).rejects.toThrow(
        /primary key.*Remove "id"/,
      )
      await expect(repository.patch(doc, { species: 'dog' })).rejects.toThrow(/readonly/)
      await expect(repository.patch(doc, { createdAt: 'x' })).rejects.toThrow(/@CreatedAt/)

      // Nothing leaked onto the instance or the node
      expect(doc.id).not.toBe('other')
      expect(await readNode(doc.id)).toMatchObject({ version: 0, species: 'cat' })
    })

    it('still patches ordinary properties and bumps the version once', async () => {
      const repository = backend.neode.getRepository(GuardedDoc)
      const doc = await backend.neode.create(GuardedDoc, { title: 'Home' })

      await repository.patch(doc, { title: 'About' })

      expect(await readNode(doc.id)).toMatchObject({ version: 1, title: 'About' })
    })
  })

  describe('mergeMany', () => {
    it('cannot override version, createdAt or readonly values on a matched node', async () => {
      const schema = getModel(GuardedDoc)!
      const bulk = new BulkService(backend.neode.getConnection())
      const id = '11111111-1111-4111-8111-111111111111'

      await bulk.mergeMany(GuardedDoc, schema, [{ id, title: 'One', species: 'cat' }])

      const before = await readNode(id)

      expect(before).toMatchObject({ version: 0, species: 'cat' })

      await bulk.mergeMany(GuardedDoc, schema, [
        {
          id,
          title: 'Two',
          species: 'dog',
          version: 99,
          createdAt: '1999-01-01T00:00:00Z',
        },
      ])

      const after = await readNode(id)

      expect(after).toMatchObject({ title: 'Two', version: 1, species: 'cat' })
      expect(after['createdAt']).toBe(before['createdAt'])
    })

    it('ignores a supplied version on create but keeps readonly values and createdAt', async () => {
      const schema = getModel(GuardedDoc)!
      const bulk = new BulkService(backend.neode.getConnection())
      const id = '22222222-2222-4222-8222-222222222222'

      await bulk.mergeMany(GuardedDoc, schema, [
        { id, title: 'One', species: 'cat', version: 42, createdAt: '2001-02-03T04:05:06Z' },
      ])

      expect(await readNode(id)).toMatchObject({
        version: 0,
        species: 'cat',
        createdAt: expect.stringContaining('2001-02-03') as unknown,
      })
    })
  })

  it('increment stamps the version', async () => {
    const repository = backend.neode.getRepository(GuardedDoc)
    const doc = await backend.neode.create(GuardedDoc, { title: 'Home', counter: 0 })

    expect(await repository.increment(doc, 'counter', 2)).toBe(2)

    expect(await readNode(doc.id)).toMatchObject({ version: 1 })
  })
})
