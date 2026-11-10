// The backend import loads neode.service first, resolving the
// query.service -> utils -> neode.service module cycle before the
// query services below are evaluated
import { openBackend, TestBackend } from './support/backend'
import { setDefaultNeode } from '../../src/entity-methods'
import { EventType, QueryExecutedEvent } from '../../src/common/events'
import { Direction } from '../../src/query'
import { InternalId, NodeEntity, OneToMany, String, Uuid, Version } from '../../src/decorators'
import { OptimisticLockError } from '../../src/errors'

// ---- Fixtures (per-file: decorator registry is global per module) -----------

@NodeEntity()
class LockedDoc {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String()
  title: string

  @Version()
  version: number
}

@NodeEntity()
class LockedAuthor {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String()
  name: string

  @Version()
  version: number

  @OneToMany(() => LockedBook, 'WROTE', Direction.OUTGOING)
  books: LockedBook[]
}

@NodeEntity()
class LockedBook {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String()
  title: string

  @Version()
  version: number
}

// ---------------------------------------------------------------------------

describe('@Version optimistic locking (NTS-158)', () => {
  let backend: TestBackend
  let queries: QueryExecutedEvent[]

  const statementContaining = (needle: string): QueryExecutedEvent | undefined =>
    queries.find((event) => event.cypher.includes(needle))

  beforeAll(async () => {
    backend = await openBackend()

    setDefaultNeode(backend.neode)

    backend.neode.on(EventType.QUERY_EXECUTED, (event) => queries.push(event as QueryExecutedEvent))
  })

  beforeEach(() => {
    queries = []
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('create() stamps version 0', async () => {
    const doc = await backend.neode.create(LockedDoc, { title: 'Home' })

    expect(doc.version).toBe(0)
  })

  it('a clean tracked save() is a no-op: the version is never bumped', async () => {
    const doc = await backend.neode.create(LockedDoc, { title: 'Home' })

    queries.length = 0

    await doc.save()

    expect(queries).toHaveLength(0)

    const found = await backend.neode.find(LockedDoc, doc.id)

    expect(found?.version).toBe(0)
  })

  it('a dirty save() guards the hydrated version and bumps by exactly 1', async () => {
    const doc = await backend.neode.create(LockedDoc, { title: 'Home' })

    doc['title'] = 'About'
    await doc.save()

    // The guard statement ran before the merge...
    expect(statementContaining('this.version = $expectedVersion')).toBeDefined()

    // ...and the merge did not bump a second time
    const merge = statementContaining('MERGE (this:LockedDoc')

    expect(merge?.cypher).not.toContain('ON MATCH SET this.version')

    const found = await backend.neode.find(LockedDoc, doc.id)

    expect(found?.version).toBe(1)
    expect(found?.title).toBe('About')
  })

  it('update() guards on the hydrated version and bumps by exactly 1', async () => {
    const doc = await backend.neode.create(LockedDoc, { title: 'Home' })

    await doc.update({ title: 'About' })

    const found = await backend.neode.find(LockedDoc, doc.id)

    expect(found?.version).toBe(1)
    expect(found?.title).toBe('About')
  })

  it('a stale instance fails with OptimisticLockError and recovers after reload', async () => {
    const doc = await backend.neode.create(LockedDoc, { title: 'Home' })

    // A second writer wins the race: same node, its version moves on
    const other = await backend.neode.find(LockedDoc, doc.id)

    await other?.update({ title: 'Written by someone else' })

    // The stale instance still carries version 0 — its write must fail
    doc['title'] = 'Lost update'

    await expect(doc.save()).rejects.toThrow(OptimisticLockError)

    // update() is guarded the same way
    await expect(doc.update({ title: 'Lost update' })).rejects.toThrow(OptimisticLockError)

    // Not a transient failure: reloading and retrying succeeds
    const reloaded = await backend.neode.find(LockedDoc, doc.id)

    expect(reloaded?.title).toBe('Written by someone else')

    reloaded!['title'] = 'Recovered'

    await reloaded!.save()

    const recovered = await backend.neode.find(LockedDoc, doc.id)

    expect(recovered?.title).toBe('Recovered')
    expect(recovered?.version).toBe(2)
  })

  it('mergeOn maintains the version counter: 0 on create, +1 per matched write', async () => {
    const created = await backend.neode.mergeOn(
      LockedDoc,
      { id: crypto.randomUUID() },
      { title: 'v1' },
    )

    expect(created?.entity.version).toBe(0)

    const merged = await backend.neode.mergeOn(
      LockedDoc,
      { id: created?.entity.id },
      { title: 'v2' },
    )

    expect(merged?.entity.version).toBe(1)
  })

  it('version never cascades: a nested relationship-target save leaves the target version alone', async () => {
    const book = await backend.neode.create(LockedBook, { title: 'Faust' })

    // An untracked author instance saved with the existing book nested:
    // the book is reached through the author's write, so its version
    // must not move (SDN issue 2604 lesson)
    const author = new LockedAuthor()

    author.id = crypto.randomUUID()
    author.name = 'Goethe'
    author.books = [book]

    await backend.neode.save(author)

    const foundBook = await backend.neode.find(LockedBook, book.id)

    expect(foundBook?.version).toBe(0)

    const foundAuthor = await backend.neode.find(LockedAuthor, author.id)

    expect(foundAuthor?.version).toBe(0)
  })
})
