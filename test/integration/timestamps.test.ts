// The backend import loads neode.service first, resolving the
// query.service -> utils -> neode.service module cycle before the
// query services below are evaluated
import { openBackend, TestBackend } from './support/backend'
import { setDefaultNeode } from '../../src/entity-methods'
import { EventType, QueryExecutedEvent } from '../../src/common/events'
import { CreatedAt, InternalId, NodeEntity, String, UpdatedAt, Uuid } from '../../src/decorators'
import { BulkService } from '../../src/services/query/bulk.service'
import { getModel } from '../../src/meta'

// ---- Fixtures (per-file: decorator registry is global per module) -----------

@NodeEntity()
class TimestampedPage {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String()
  title: string

  @CreatedAt()
  createdAt: unknown

  @UpdatedAt()
  updatedAt: unknown
}

/**
The stamped year off a hydrated timestamp value: a driver DateTime instance
on the Bolt backends (its `year` is a driver Integer — low/high pair), the
engine's plain temporal object on Relate (a JS number) — normalise both
*/
const stampedYear = (value: unknown): unknown => {
  const year: unknown = (value as { year?: unknown } | undefined)?.year

  if (typeof year === 'object' && year !== null && 'low' in year && 'high' in year) {
    return (year as { low: number }).low
  }

  return year
}

// ---------------------------------------------------------------------------

describe('@CreatedAt / @UpdatedAt timestamps (NTS-165)', () => {
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

  it('create() stamps both timestamps server-side with datetime()', async () => {
    const page = await backend.neode.create(TimestampedPage, { title: 'Home' })

    expect(queries[0]?.cypher).toContain('createdAt: datetime()')
    expect(queries[0]?.cypher).toContain('updatedAt: datetime()')

    // The database clock wrote them: a year in the present decade
    expect(stampedYear(page.createdAt)).toBe(new Date().getFullYear())
    expect(stampedYear(page.updatedAt)).toBe(new Date().getFullYear())
  })

  it('a clean tracked save() is a no-op: updatedAt is never touched', async () => {
    const page = await backend.neode.create(TimestampedPage, { title: 'Home' })

    queries.length = 0

    await page.save()

    expect(queries).toHaveLength(0)
  })

  it('a dirty save() bumps updatedAt and preserves createdAt', async () => {
    const page = await backend.neode.create(TimestampedPage, { title: 'Home' })

    page['title'] = 'About'
    await page.save()

    const merge = statementContaining('MERGE (this:TimestampedPage')

    expect(merge?.cypher).toContain('ON MATCH SET this.updatedAt = datetime()')

    const found = await backend.neode.find(TimestampedPage, page.id)

    // createdAt survives the write byte-for-byte, updatedAt is re-stamped
    expect(found?.createdAt).toEqual(page.createdAt)
    expect(stampedYear(found?.updatedAt)).toBe(new Date().getFullYear())
  })

  it('update() bumps updatedAt and never rewrites createdAt', async () => {
    const page = await backend.neode.create(TimestampedPage, { title: 'Home' })

    await page.update({ title: 'About' })

    const update = statementContaining('this.updatedAt = datetime()')

    expect(update?.cypher).toContain('this.updatedAt = datetime()')
    expect(update?.cypher).not.toContain('this.createdAt')

    const found = await backend.neode.find(TimestampedPage, page.id)

    expect(found?.['title']).toBe('About')
    expect(found?.createdAt).toEqual(page.createdAt)
    expect(stampedYear(found?.updatedAt)).toBe(new Date().getFullYear())
  })

  it('mergeOn stamps both on create and updatedAt on the match path', async () => {
    const created = await backend.neode.mergeOn(
      TimestampedPage,
      { id: crypto.randomUUID() },
      { title: 'v1' },
    )

    queries.length = 0

    const merged = await backend.neode.mergeOn(
      TimestampedPage,
      { id: created?.id },
      { title: 'v2' },
    )

    const merge = statementContaining('MERGE (this:TimestampedPage')

    expect(merge?.cypher).toContain(
      'ON CREATE SET this.createdAt = datetime(), this.updatedAt = datetime()',
    )
    expect(merge?.cypher).toContain('ON MATCH SET this.updatedAt = datetime()')

    // createdAt survives the matched write byte-for-byte
    expect(merged?.createdAt).toEqual(created?.createdAt)
    expect(stampedYear(merged?.updatedAt)).toBe(new Date().getFullYear())
  })

  it('createMany stamps every row', async () => {
    const bulk = new BulkService(backend.connection)

    const [chunk] = await bulk.createMany(TimestampedPage, getModel(TimestampedPage)!, [
      { id: crypto.randomUUID(), title: 'A' },
      { id: crypto.randomUUID(), title: 'B' },
    ])

    expect(chunk?.count).toBe(2)

    for (const entity of chunk?.entities ?? []) {
      expect(stampedYear(entity.createdAt)).toBe(new Date().getFullYear())
      expect(stampedYear(entity.updatedAt)).toBe(new Date().getFullYear())
    }
  })

  it('mergeMany stamps created and matched rows', async () => {
    const bulk = new BulkService(backend.connection)
    const schema = getModel(TimestampedPage)!
    const id = crypto.randomUUID()

    const [created] = await bulk.mergeMany(TimestampedPage, schema, [{ id, title: 'A' }])

    const [merged] = await bulk.mergeMany(TimestampedPage, schema, [{ id, title: 'B' }])

    // Bulk transactions emit no QUERY_EXECUTED events on every backend,
    // so the stamp clauses are asserted in test/unit/timestamps.test.ts —
    // here the merged row itself proves the match path: createdAt
    // survives byte-for-byte, updatedAt is re-stamped
    expect(merged?.entities[0]?.createdAt).toEqual(created?.entities[0]?.createdAt)
    expect(stampedYear(merged?.entities[0]?.updatedAt)).toBe(new Date().getFullYear())
    expect(merged?.entities[0]?.title).toBe('B')
  })
})
