import { openBackend, TestBackend } from './support/backend'
import {
  NodeEntity,
  Uuid,
  String,
  Number,
  InternalId,
  DateTime,
  OneToMany,
  Point,
  Date,
  Property,
} from '../../src/decorators'
import { Direction } from '../../src/query'
import { getModel } from '../../src/meta'
import { ValidationError } from '../../src/validation'
import { BulkService } from '../../src/services/query/bulk.service'
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
