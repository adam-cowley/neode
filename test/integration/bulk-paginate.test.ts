import { openBackend, TestBackend } from './support/backend'
import {
  NodeEntity,
  Uuid,
  Version,
  String,
  Number,
  InternalId,
  DateTime,
  OneToMany,
  Point,
  Date,
  Property,
  Unique,
  UpdatedAt,
} from '../../src/decorators'
import { Direction } from '../../src/query'
import { getModel } from '../../src/meta'
import { ValidationError } from '../../src/validation'
import { BulkService, BulkChunkError } from '../../src/services/query/bulk.service'
import { PaginateService } from '../../src/services/query/paginate.service'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class BulkPerson {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ min: 2 })
  name: string

  @Number()
  visits: number

  @DateTime()
  createdAt: string
}

@NodeEntity()
class BulkVersioned {
  @InternalId()
  _id: string

  @Property({ type: 'string', primary: true })
  key: string

  @Property({ type: 'number' })
  hits: number

  @Version()
  @Property({ type: 'number' })
  version: number
}

@NodeEntity()
class BulkPlace {
  @InternalId()
  _id: string

  @Property({ type: 'string', primary: true })
  placeID: string

  @Property({ type: 'string' })
  name: string

  @Point()
  located: unknown

  @Date()
  founded: string
}

@NodeEntity()
class BulkDated {
  @InternalId()
  _id: string

  @Property({ type: 'string' })
  name: string

  // A typed merge key: file sources deliver it as a string (NTS-637)
  @Property({ type: 'date', unique: true })
  day: string
}

@NodeEntity()
class BulkStamped {
  @InternalId()
  _id: string

  @Property({ type: 'string' })
  name: string

  // The NTS-612 iso-string form: the stored value is the string rendering,
  // so a string match value must stay a string (NTS-638)
  @Unique()
  @UpdatedAt({ format: 'iso-string' })
  @DateTime()
  syncedAt: string
}

@NodeEntity()
class BulkAccount {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  name: string

  @Number()
  visits: number
}

@NodeEntity()
class BulkPost {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ min: 2 })
  title: string

  @OneToMany(() => BulkPerson, 'WROTE', Direction.OUTGOING)
  author: BulkPerson[]
}

// NTS-649: the poison-row fixture — `code` carries a server-side unique
// constraint installed (and dropped) by the failure-reporting describe below
@NodeEntity()
class BulkUniqueRow {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  code: string

  @Property({ type: 'string' })
  name: string
}

// ---------------------------------------------------------------------------

describe('bulk (createMany / mergeMany)', () => {
  let backend: TestBackend
  let bulk: BulkService

  beforeAll(async () => {
    backend = await openBackend()
    bulk = new BulkService(backend.connection)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('creates rows in chunks and hydrates the results', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ name: `Person ${i}`, visits: i }))
    const schema = getModel(BulkPerson)!

    const chunks = await bulk.createMany(BulkPerson, schema, rows, { chunkSize: 2 })

    // One result per chunk: 2 + 2 + 1
    expect(chunks.map((result) => result.count)).toEqual([2, 2, 1])
    expect(chunks.flatMap((result) => result.entities)).toHaveLength(5)

    const all = chunks.flatMap((result) => result.entities) as BulkPerson[]

    all.forEach((entity, i) => {
      expect(entity).toBeInstanceOf(BulkPerson)
      expect(entity.name).toBe(rows[i].name)
      expect(entity.visits).toBe(i)
      expect(entity.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      expect(entity._id).toBeDefined()
    })

    const count = await backend.neode.readCypher('MATCH (n:BulkPerson) RETURN count(n) AS n')

    expect(count.records[0].get('n')).toBe(5)
  })

  it('returns no chunks for no rows', async () => {
    const schema = getModel(BulkPerson)!

    expect(await bulk.createMany(BulkPerson, schema, [])).toEqual([])
  })

  it('validates every row before writing anything', async () => {
    const schema = getModel(BulkPerson)!

    await expect(
      bulk.createMany(BulkPerson, schema, [
        { name: 'Valid Name', visits: 1 },
        { name: 'x', visits: 2 },
      ]),
    ).rejects.toThrow(ValidationError)

    const count = await backend.neode.readCypher('MATCH (n:BulkPerson) RETURN count(n) AS n')

    expect(count.records[0].get('n')).toBe(0)
  })

  it('ignores unknown keys but rejects declared relationship values', async () => {
    const schema = getModel(BulkPerson)!

    // Unknown keys are ignored (allowUnknown parity with the create path)
    const created = await bulk.createMany(BulkPerson, schema, [
      { name: 'Adam', unknownKey: 'ignored' },
    ])

    expect((created[0].entities[0] as BulkPerson).name).toBe('Adam')

    // A declared relationship key must fail loudly rather than be dropped
    const postsSchema = getModel(BulkPost)!

    await expect(
      bulk.createMany(BulkPost, postsSchema, [{ author: { name: 'Adam' } }]),
    ).rejects.toThrow(/relationship/i)
  })

  it('creates when merge fields are new and updates when they already exist', async () => {
    const schema = getModel(BulkAccount)!

    const created = await bulk.mergeMany(BulkAccount, schema, [
      { name: 'adam', visits: 1 },
      { name: 'bob', visits: 2 },
    ])

    expect(created.flatMap((result) => result.entities)).toHaveLength(2)

    // Merging the same names again must match, not duplicate
    const merged = await bulk.mergeMany(BulkAccount, schema, [
      { name: 'adam', visits: 10 },
      { name: 'bob', visits: 20 },
    ])

    expect(merged.flatMap((result) => result.entities)).toHaveLength(2)

    const count = await backend.neode.readCypher('MATCH (n:BulkAccount) RETURN count(n) AS n')

    expect(count.records[0].get('n')).toBe(2)

    const adam = await backend.neode.getFirst<BulkAccount>(BulkAccount, { name: 'adam' })

    expect(adam!.visits).toBe(10)

    // The merge did not regenerate the primary key UUID
    const firstRun = created.flatMap((result) => result.entities) as BulkAccount[]
    expect(adam!.id).toBe(firstRun.find((entity) => entity.name === 'adam')!.id)
  })

  it('throws when a row sets no merge field', async () => {
    const schema = getModel(BulkAccount)!

    await expect(bulk.mergeMany(BulkAccount, schema, [{ visits: 5 }])).rejects.toThrow(
      /merge field/i,
    )
  })

  it('throws when rows merge on different merge fields', async () => {
    const schema = getModel(BulkAccount)!

    await expect(
      bulk.mergeMany(BulkAccount, schema, [
        { name: 'adam', visits: 1 },
        { id: '0c0ffee0-0000-4000-8000-000000000000', visits: 2 },
      ]),
    ).rejects.toThrow(/same merge field/i)
  })

  it('rejects a non-positive chunk size', async () => {
    const schema = getModel(BulkPerson)!

    await expect(
      bulk.createMany(BulkPerson, schema, [{ name: 'Adam' }], { chunkSize: 0 }),
    ).rejects.toThrow(/chunkSize/i)
  })
})

// ---- NTS-649: a failed chunk names its failing rows; its valid rows roll back with it ----

describe('bulk chunk failure reporting (NTS-649)', () => {
  let backend: TestBackend
  let bulk: BulkService

  const schema = () => getModel(BulkUniqueRow)!

  beforeAll(async () => {
    backend = await openBackend()
    bulk = new BulkService(backend.connection)

    if (backend.capabilities.constraints) {
      await backend.connection.run(
        'CREATE CONSTRAINT bulk_nts649_code IF NOT EXISTS FOR (n:BulkUniqueRow) REQUIRE n.code IS UNIQUE',
      )
    }
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    if (backend.capabilities.constraints) {
      try {
        await backend.connection.run('DROP CONSTRAINT bulk_nts649_code IF EXISTS')
      } catch {
        // not all backends support dropping constraints
      }
    }

    await backend.close()
  })

  it('reports the failing row of a mid-import chunk and rolls the chunk back', async () => {
    if (!backend.capabilities.constraints) {
      return
    }

    // The poison target: a node the batch's third row collides with
    await backend.connection.run(
      "CREATE (:BulkUniqueRow { code: 'taken-1', name: 'pre-existing' })",
    )

    const error = await bulk
      .createMany(
        BulkUniqueRow,
        schema(),
        [
          { code: 'row-0', name: 'Ok 0' },
          { code: 'row-1', name: 'Ok 1' },
          { code: 'taken-1', name: 'Poison' },
          { code: 'row-3', name: 'Ok 3' },
        ],
        { chunkSize: 2 },
      )
      .then(
        () => null,
        (thrown) => thrown,
      )

    expect(error).toBeInstanceOf(BulkChunkError)
    expect(error?.chunkIndex).toBe(1)
    expect(error?.failedRows.map((failure) => failure.index)).toEqual([2])
    expect(error?.message).toContain('earlier chunks stay committed')

    // Fate: the first chunk committed; the failed chunk's valid row
    // (index 3) rolled back with it, and the pre-existing node survives
    const stored = await backend.neode.readCypher(
      'MATCH (n:BulkUniqueRow) RETURN n.code AS code ORDER BY n.code',
    )

    expect(stored.records.map((record) => record.get('code'))).toEqual([
      'row-0',
      'row-1',
      'taken-1',
    ])
  })

  it('reports every failing row of a chunk together', async () => {
    if (!backend.capabilities.constraints) {
      return
    }

    await backend.connection.run(
      "UNWIND $targets AS target CREATE (:BulkUniqueRow { code: target, name: 'pre-existing' })",
      { targets: ['taken-1', 'taken-2'] },
    )

    const error = await bulk
      .createMany(
        BulkUniqueRow,
        schema(),
        [
          { code: 'row-0', name: 'Ok 0' },
          { code: 'taken-1', name: 'Poison 1' },
          { code: 'row-2', name: 'Ok 2' },
          { code: 'taken-2', name: 'Poison 2' },
        ],
        { chunkSize: 4 },
      )
      .then(
        () => null,
        (thrown) => thrown,
      )

    expect(error).toBeInstanceOf(BulkChunkError)
    expect(error?.chunkIndex).toBe(0)
    expect(error?.failedRows.map((failure) => failure.index)).toEqual([1, 3])
  })
})

describe('paginate', () => {
  let backend: TestBackend
  let paginate: PaginateService

  beforeAll(async () => {
    backend = await openBackend()
    paginate = new PaginateService(backend.connection)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  const schema = () => getModel(BulkPerson)!

  /** Seed N people, then stamp distinct createdAt datetimes via Cypher */
  async function seedTimeline(count: number): Promise<void> {
    // NB: the String decorator shadows the global — use toString()
    const name = (i: number) => `Person ${i.toString().padStart(2, '0')}`

    await new BulkService(backend.connection).createMany(
      BulkPerson,
      schema(),
      Array.from({ length: count }, (_, i) => ({
        name: name(i),
        visits: i,
      })),
    )

    await backend.connection.run(
      'UNWIND $entries AS entry ' +
        'MATCH (p:BulkPerson { name: entry.name }) ' +
        'SET p.createdAt = datetime(entry.when)',
      {
        entries: Array.from({ length: count }, (_, i) => ({
          name: name(i),
          when: `2026-01-01T00:00:${i.toString().padStart(2, '0')}Z`,
        })),
      },
    )
  }

  describe('offset mode', () => {
    it('returns the requested page with totals', async () => {
      await seedTimeline(10)

      const page1 = await paginate.paginate(BulkPerson, schema(), {}, { page: 1, limit: 4 })
      const page2 = await paginate.paginate(BulkPerson, schema(), {}, { page: 2, limit: 4 })
      const page3 = await paginate.paginate(BulkPerson, schema(), {}, { page: 3, limit: 4 })

      expect(page1).toMatchObject({ total: 10, page: 1, limit: 4, totalPages: 3 })
      expect(page1.items).toHaveLength(4)
      expect(page2.items).toHaveLength(4)
      expect(page3.items).toHaveLength(2)

      // The pages do not overlap
      const names = [page1, page2, page3].flatMap((page) =>
        (page.items as BulkPerson[]).map((person) => person.name),
      )

      expect(new Set(names).size).toBe(10)
    })

    it('returns an empty page beyond the last', async () => {
      await seedTimeline(3)

      const page = await paginate.paginate(BulkPerson, schema(), {}, { page: 2, limit: 4 })

      expect(page.items).toEqual([])
      expect(page.total).toBe(3)
      expect(page.totalPages).toBe(1)
    })

    it('applies the property filter to both queries', async () => {
      await seedTimeline(6)

      const page = await paginate.paginate(
        BulkPerson,
        schema(),
        { visits: 3 },
        { page: 1, limit: 10 },
      )

      expect(page.total).toBe(1)
      expect((page.items[0] as BulkPerson).name).toBe('Person 03')
    })

    it('applies an order spec', async () => {
      await seedTimeline(5)

      const page = await paginate.paginate(
        BulkPerson,
        schema(),
        {},
        {
          page: 1,
          limit: 5,
          order: { name: 'DESC' },
        },
      )

      const names = (page.items as BulkPerson[]).map((person) => person.name)

      expect(names).toEqual([...names].sort().reverse())
    })

    it('rejects a non-positive limit', async () => {
      await expect(
        paginate.paginate(BulkPerson, schema(), {}, { page: 1, limit: 0 }),
      ).rejects.toThrow(/limit/i)
    })
  })

  describe('cursor mode', () => {
    it('walks forward in chronological pages with no overlap or loss', async () => {
      await seedTimeline(6)

      const seen: BulkPerson[] = []
      let after: string | undefined
      let hasMore = true
      let turns = 0

      while (hasMore) {
        const page = await paginate.paginate(
          BulkPerson,
          schema(),
          {},
          {
            limit: 2,
            orderBy: 'createdAt',
            after,
          },
        )

        const visits = (page.items as BulkPerson[]).map((person) => person.visits)

        expect(visits).toEqual([turns * 2, turns * 2 + 1])
        expect(page.hasMore).toBe(turns < 2)

        seen.push(...(page.items as BulkPerson[]))
        hasMore = page.hasMore
        after = page.nextCursor
        turns++

        expect(turns).toBeLessThanOrEqual(4)
      }

      expect(turns).toBe(3)
      expect(seen).toHaveLength(6)
      expect(new Set(seen.map((person) => person.name)).size).toBe(6)
    })

    it('walks pages with no loss when every cursor value ties', async () => {
      // Six rows stamped with the SAME createdAt (bulk writes land in the
      // same millisecond): the tie-break on elementId must keep every row
      // in the walk
      await new BulkService(backend.connection).createMany(
        BulkPerson,
        schema(),
        Array.from({ length: 6 }, (_, i) => ({ name: `Tied ${i}`, visits: i })),
      )

      await backend.connection.run(
        "MATCH (p:BulkPerson) WHERE p.name STARTS WITH 'Tied ' " +
          'SET p.createdAt = datetime("2026-02-03T04:05:06Z")',
      )

      const seen: BulkPerson[] = []
      let after: string | number | undefined
      let hasMore = true
      let turns = 0

      while (hasMore) {
        const page = await paginate.paginate(
          BulkPerson,
          schema(),
          {},
          { limit: 2, orderBy: 'createdAt', after },
        )

        // Pages must not overlap: every visit count appears exactly once
        for (const person of page.items as BulkPerson[]) {
          expect(seen.some((s) => s.visits === person.visits)).toBe(false)
        }

        seen.push(...(page.items as BulkPerson[]))
        hasMore = page.hasMore
        after = page.nextCursor
        turns++

        expect(turns).toBeLessThanOrEqual(4)
      }

      expect(turns).toBe(3)
      expect(seen).toHaveLength(6)
      expect(seen.map((person) => person.visits).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
    })

    it('reports hasMore=false with no nextCursor on the last page', async () => {
      await seedTimeline(4)

      const page = await paginate.paginate(
        BulkPerson,
        schema(),
        {},
        {
          limit: 10,
          orderBy: 'createdAt',
        },
      )

      expect(page.items).toHaveLength(4)
      expect(page.hasMore).toBe(false)
      expect(page.nextCursor).toBeUndefined()
    })

    it('walks backwards with before and returns items ascending', async () => {
      await seedTimeline(6)

      // Cursor of the newest item (the end of the timeline)
      const raw = await backend.connection.run(
        'MATCH (p:BulkPerson { name: $name }) RETURN toString(p.createdAt) AS cursor',
        { name: 'Person 05' },
      )

      const page = await paginate.paginate(
        BulkPerson,
        schema(),
        {},
        {
          limit: 2,
          orderBy: 'createdAt',
          before: raw.records[0].get('cursor') as string,
        },
      )

      expect((page.items as BulkPerson[]).map((person) => person.visits)).toEqual([3, 4])
      expect(page.hasMore).toBe(true)

      // Continuing backwards reaches the remaining items
      const page2 = await paginate.paginate(
        BulkPerson,
        schema(),
        {},
        {
          limit: 10,
          orderBy: 'createdAt',
          before: page.nextCursor,
        },
      )

      expect((page2.items as BulkPerson[]).map((person) => person.visits)).toEqual([0, 1, 2])
      expect(page2.hasMore).toBe(false)
    })

    it('combines the property filter with the cursor', async () => {
      await seedTimeline(6)

      const first = await paginate.paginate(
        BulkPerson,
        schema(),
        { visits: 0 },
        {
          limit: 1,
          orderBy: 'createdAt',
        },
      )

      expect((first.items as BulkPerson[]).map((person) => person.name)).toEqual(['Person 00'])
      expect(first.hasMore).toBe(false)
    })

    it('paginates on a non-temporal property without a cast', async () => {
      await seedTimeline(5)

      const page = await paginate.paginate(
        BulkPerson,
        schema(),
        {},
        {
          limit: 2,
          orderBy: 'visits',
          after: 2,
        },
      )

      expect((page.items as BulkPerson[]).map((person) => person.visits)).toEqual([3, 4])
      expect(page.hasMore).toBe(false)
    })

    it('completes the walk when some rows lack the cursor key (NTS-592)', async () => {
      // Four rows, three with the key removed. The old walk took a null
      // boundary into the cursor ('[null, …]') and the next page crashed
      // on datetime('[null, …]') — or stopped silently on a non-temporal
      // key. Null-key rows are now excluded deterministically: the walk
      // covers the set-key rows and ends cleanly.
      await new BulkService(backend.connection).createMany(
        BulkPerson,
        schema(),
        Array.from({ length: 4 }, (_, i) => ({ name: `Person ${i}`, visits: i })),
      )

      await backend.connection.run(
        "MATCH (p:BulkPerson) WHERE p.name <> 'Person 0' REMOVE p.createdAt",
      )

      // createMany does not stamp @DateTime — set the one key explicitly
      await backend.connection.run(
        'MATCH (p:BulkPerson { name: $name }) SET p.createdAt = datetime($when)',
        { name: 'Person 0', when: '2026-01-01T00:00:00Z' },
      )

      const seen: BulkPerson[] = []

      for await (const person of paginate.lazy<BulkPerson>(
        BulkPerson,
        schema(),
        {},
        { limit: 2, orderBy: 'createdAt' },
      )) {
        seen.push(person)
      }

      expect(seen.map((person) => person.name)).toEqual(['Person 0'])
    })

    it('rejects an unknown cursor property and ambiguous options', async () => {
      await expect(
        paginate.paginate(BulkPerson, schema(), {}, { limit: 2, orderBy: 'nope' }),
      ).rejects.toThrow(/cursor property/i)

      await expect(
        paginate.paginate(
          BulkPerson,
          schema(),
          {},
          {
            limit: 2,
            orderBy: 'createdAt',
            after: 'x',
            before: 'y',
          },
        ),
      ).rejects.toThrow(/after or before/i)
    })
  })
})

describe('findManyAndCount / chunk / lazy (NTS-166)', () => {
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

  const schema = () => getModel(BulkPerson)!

  /** Seed N people, then stamp distinct createdAt datetimes via Cypher */
  async function seedTimeline(count: number): Promise<void> {
    // NB: the String decorator shadows the global — use toString()
    const name = (i: number) => `Person ${i.toString().padStart(2, '0')}`

    await new BulkService(backend.connection).createMany(
      BulkPerson,
      schema(),
      Array.from({ length: count }, (_, i) => ({
        name: name(i),
        visits: i,
      })),
    )

    await backend.connection.run(
      'UNWIND $entries AS entry ' +
        'MATCH (p:BulkPerson { name: entry.name }) ' +
        'SET p.createdAt = datetime(entry.when)',
      {
        entries: Array.from({ length: count }, (_, i) => ({
          name: name(i),
          when: `2026-01-01T00:00:${i.toString().padStart(2, '0')}Z`,
        })),
      },
    )
  }

  describe('findManyAndCount', () => {
    it('returns every matching entity with its total in one call', async () => {
      await seedTimeline(6)

      const result = await backend.neode.findManyAndCount<BulkPerson>(BulkPerson)

      expect(result.total).toBe(6)
      expect(result.items).toHaveLength(6)
      expect(result.items.every((person) => person instanceof BulkPerson)).toBe(true)
    })

    it('applies the property filter to both the items and the total', async () => {
      await seedTimeline(6)

      const result = await backend.neode.findManyAndCount<BulkPerson>(BulkPerson, { visits: 3 })

      expect(result.total).toBe(1)
      expect(result.items.map((person) => person.name)).toEqual(['Person 03'])
    })

    it('lets order/limit/skip trim the items while total counts the filter', async () => {
      await seedTimeline(6)

      const result = await backend.neode.findManyAndCount<BulkPerson>(
        BulkPerson,
        {},
        {
          order: { visits: 'DESC' },
          limit: 2,
          skip: 1,
        },
      )

      expect(result.total).toBe(6)
      expect(result.items.map((person) => person.visits)).toEqual([4, 3])
    })
  })

  describe('chunk', () => {
    it('delivers every row in keyset-ordered pages of the requested size', async () => {
      await seedTimeline(5)

      const pages: number[][] = []

      const delivered = await backend.neode.chunk<BulkPerson>(BulkPerson, {}, 2, (people) => {
        pages.push(people.map((person) => person.visits))
      })

      expect(pages).toEqual([[0, 1], [2, 3], [4]])
      expect(delivered).toBe(5)
    })

    it('stops the walk when the callback returns false', async () => {
      await seedTimeline(5)

      let delivered = 0

      const seen = await backend.neode.chunk<BulkPerson>(BulkPerson, {}, 2, (people) => {
        delivered += people.length

        return false
      })

      expect(delivered).toBe(2)
      expect(seen).toBe(2)
    })

    it('rejects a non-positive size and an unknown cursor property', async () => {
      await seedTimeline(2)

      await expect(
        backend.neode.chunk<BulkPerson>(BulkPerson, {}, 0, () => undefined),
      ).rejects.toThrow(/limit/i)

      await expect(
        backend.neode.chunk<BulkPerson>(BulkPerson, {}, 2, () => undefined, { orderBy: 'nope' }),
      ).rejects.toThrow(/cursor property/i)
    })
  })

  describe('lazy', () => {
    it('yields every entity in keyset order across pages', async () => {
      await seedTimeline(5)

      const visits: number[] = []

      for await (const person of backend.neode.lazy<BulkPerson>(BulkPerson, {}, { limit: 2 })) {
        visits.push(person.visits)
      }

      expect(visits).toEqual([0, 1, 2, 3, 4])
    })

    it('stops cleanly on early break and leaves the connection usable', async () => {
      await seedTimeline(5)

      const visits: number[] = []

      for await (const person of backend.neode.lazy<BulkPerson>(BulkPerson, {}, { limit: 2 })) {
        visits.push(person.visits)

        if (visits.length === 2) {
          break
        }
      }

      expect(visits).toEqual([0, 1])

      // The broken walk left nothing open: a fresh iteration completes
      const after: number[] = []

      for await (const person of backend.neode.lazy<BulkPerson>(BulkPerson, {}, { limit: 2 })) {
        after.push(person.visits)
      }

      expect(after).toEqual([0, 1, 2, 3, 4])
    })

    it('rejects an unknown cursor property', async () => {
      await seedTimeline(2)

      const walk = async (): Promise<number[]> => {
        const seen: number[] = []

        for await (const person of backend.neode.lazy<BulkPerson>(
          BulkPerson,
          {},
          {
            orderBy: 'nope',
          },
        )) {
          seen.push(person.visits)
        }

        return seen
      }

      await expect(walk()).rejects.toThrow(/cursor property/i)
    })
  })
})

// ---- NTS-506: bulk rows convert property values like the single path ----

describe('bulk value conversion (NTS-506)', () => {
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

  it('mergeMany converts @Point and @Date values exactly like create()', async () => {
    const rows = [
      {
        placeID: 'p1',
        name: 'Origin',
        located: { latitude: 35.68, longitude: 139.69 },
        founded: '1950-04-01',
      },
      {
        placeID: 'p2',
        name: 'Near',
        located: { latitude: 51.51, longitude: -0.13 },
        founded: '1960-06-15',
      },
    ]

    const chunks = await new BulkService(backend.neode.getConnection()).mergeMany(
      BulkPlace,
      getModel(BulkPlace),
      rows,
    )

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.entities).toHaveLength(2)

    const stored = await backend.neode.readCypher(
      'MATCH (p:BulkPlace) RETURN p.placeID AS id, p.located AS located, p.founded AS founded ORDER BY p.placeID',
      {},
    )

    expect(stored.records).toHaveLength(2)

    const origin = stored.records[0]
    const point = origin?.get('located') as { srid?: number; x?: number; y?: number }

    // Converted to a driver Point (geographic SRID 4326, longitude as x) —
    // not the raw { latitude, longitude } object
    expect(point).toMatchObject({ srid: 4326, x: 139.69, y: 35.68 })

    const founded = origin?.get('founded') as { year?: number }

    expect(founded).toMatchObject({ year: 1950, month: 4, day: 1 })
  })

  it('createMany converts too', async () => {
    await new BulkService(backend.neode.getConnection()).createMany(
      BulkPlace,
      getModel(BulkPlace),
      [
        {
          placeID: 'p3',
          name: 'Converted',
          located: { latitude: 1.35, longitude: 103.82 },
          founded: '1971-09-03',
        },
      ],
    )

    const output = await backend.neode.readCypher(
      'MATCH (p:BulkPlace { placeID: "p3" }) RETURN p.located AS located',
      {},
    )

    const point = output.records[0]?.get('located') as { srid?: number }

    expect(point.srid).toBe(4326)
  })
})

// ---- NTS-528: bulk mergeMany on a @Version model renders valid Cypher ----

describe('bulk mergeMany with @Version (NTS-528)', () => {
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

  it('merges a versioned model: creates at 0, bumps on match', async () => {
    const service = new BulkService(backend.neode.getConnection())

    await service.mergeMany(BulkVersioned, getModel(BulkVersioned), [{ key: 'k1', hits: 1 }])

    const first = await backend.neode.readCypher(
      'MATCH (b:BulkVersioned) RETURN b.version AS v',
      {},
    )

    // The client decodes ints as a lazy numeric (JSON shows the number)
    const firstVersion = first.records[0]?.get('v') as unknown as number

    expect(firstVersion + 0).toBe(0)

    await service.mergeMany(BulkVersioned, getModel(BulkVersioned), [{ key: 'k1', hits: 5 }])

    const second = await backend.neode.readCypher(
      'MATCH (b:BulkVersioned) RETURN b.version AS v, b.hits AS h',
      {},
    )

    const version = second.records[0]?.get('v') as unknown as number
    const hits = second.records[0]?.get('h') as unknown as number

    expect(version + 0).toBe(1)
    expect(hits + 0).toBe(5)
  })
})

// ---- NTS-637: merge match keys convert through the schema ----

describe('bulk merge-key conversion (NTS-637)', () => {
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

  it('mergeMany matches a typed merge key given as string file data', async () => {
    const service = new BulkService(backend.neode.getConnection())
    const schema = getModel(BulkDated)

    const first = await service.mergeMany(BulkDated, schema, [
      { day: '2024-01-01', name: 'First' },
      { day: '2024-01-02', name: 'Second' },
    ])

    expect(first[0]?.entities).toHaveLength(2)

    // Re-running the same file: the string form must match the stored
    // (converted) temporal value — without conversion the MERGE never
    // matches and silently duplicates
    const second = await service.mergeMany(BulkDated, schema, [
      { day: '2024-01-01', name: 'First updated' },
    ])

    expect(second[0]?.entities).toHaveLength(1)

    const stored = await backend.neode.readCypher(
      'MATCH (d:BulkDated) RETURN d.name AS name, d.day AS day ORDER BY d.name',
      {},
    )

    expect(stored.records).toHaveLength(2)
    expect(stored.records.map((record) => record.get('name'))).toEqual(['First updated', 'Second'])

    const day = stored.records[1]?.get('day') as { year?: number }

    expect(day).toMatchObject({ year: 2024, month: 1, day: 2 })
  })

  it('mergeMany matches an iso-string merge key given as string file data (NTS-638)', async () => {
    const service = new BulkService(backend.neode.getConnection())
    const schema = getModel(BulkStamped)

    await service.mergeMany(BulkStamped, schema, [
      { syncedAt: '2024-03-04T05:06:07Z', name: 'First' },
    ])

    await service.mergeMany(BulkStamped, schema, [
      { syncedAt: '2024-03-04T05:06:07Z', name: 'First updated' },
    ])

    const stored = await backend.neode.readCypher(
      'MATCH (s:BulkStamped) RETURN s.name AS name, s.syncedAt AS syncedAt',
      {},
    )

    // The string match value equals the stored string form — matched and
    // updated, not duplicated
    expect(stored.records).toHaveLength(1)
    expect(stored.records[0]?.get('name')).toBe('First updated')
    expect(stored.records[0]?.get('syncedAt')).toBe('2024-03-04T05:06:07Z')
  })

  it('facade rowToProperties resolves the schema and maps rows (NTS-641)', async () => {
    const ok = await backend.neode.rowToProperties(BulkPerson, {
      id: '0c0ffee0-0000-4000-8000-000000000000',
      name: 'Adam',
      visits: '3',
    })

    expect(ok.ok).toBe(true)

    if (ok.ok) {
      expect(ok.properties.visits).toBe(3)
    }

    const bad = await backend.neode.rowToProperties(BulkPerson, { name: 'A' })

    expect(bad.ok).toBe(false)
  })
})
