import { Neode } from '../../src/neode.service'
import { defineModel } from '../../src/meta/map-schema'
import { NodeEntity, InternalId, Uuid, String, OneToMany } from '../../src/decorators'
import { Direction } from '../../src/query'
import { ValidationError } from '../../src/validation'
import {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams,
  QueryRecord,
  TransactionHandle,
} from '../../src/driver/types'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

let emailCounter = 0

/** Fake generator for the unique email property, overridable per test */
let emailFake: () => string = () => `user-${++emailCounter}@example.com`

let nicknameValue = 'nick'

@NodeEntity()
class SeedPost {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String()
  title: string
}

@NodeEntity()
class SeedPerson {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true, fake: () => emailFake() })
  email: string

  @String({ default: 'Springfield', fake: () => 'Shelbyville' })
  city: string

  @String({ min: 4, fake: () => nicknameValue })
  nickname: string

  @OneToMany(() => SeedPost, 'WROTE', Direction.OUTGOING)
  posts: SeedPost[]
}

// ---- ConnectionProvider fake ------------------------------------------------

let elementIds = 0

function elementIdRecord(): QueryRecord {
  const id = `4:unit:${++elementIds}`

  return {
    get: (key: string) => (key === '__id' ? id : undefined),
    has: () => true,
    keys: ['__id'],
  }
}

function nodeRecord(): QueryRecord {
  const node = {
    elementId: `4:unit:node-${elementIds}`,
    labels: ['SeedPerson'],
    properties: { id: 'u1', email: 'x@example.com', nickname: 'nick' },
  }

  return {
    get: (key: string) => (key === 'this' ? node : undefined),
    has: () => true,
    keys: ['this'],
  }
}

interface CapturedCall {
  statement: string
  params?: QueryParams
}

/** Records every in-transaction statement and answers CREATE / FIND / relate shapes. */
class FactoryProvider implements ConnectionProvider {
  readonly txCalls: CapturedCall[] = []

  async run(): Promise<QueryOutput> {
    return { records: [] }
  }

  async beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle> {
    return {
      run: async (statement: string, params?: QueryParams) => {
        this.txCalls.push({ statement, params })

        // CREATE ... RETURN elementId(this) AS __id → the created elementId;
        // MATCH ... RETURN this → the hydrated node; MERGE (relate) → empty
        if (statement.startsWith('CREATE')) {
          return { records: [elementIdRecord()] }
        }

        if (statement.includes('MERGE')) {
          return { records: [] }
        }

        return { records: [nodeRecord()] }
      },
      commit: async () => {},
      rollback: async () => {},
    }
  }

  async edition(): Promise<'community'> {
    return 'community'
  }

  async close(): Promise<void> {}
}

/** The CREATE statements captured by the provider, in order, with unprefixed property params. */
function creates(
  provider: FactoryProvider,
): { labels: string[]; params: Record<string, unknown> }[] {
  return provider.txCalls
    .filter((call) => call.statement.startsWith('CREATE'))
    .map((call) => ({
      // Node labels are inline in the pattern: CREATE (this:Label { ... })
      labels: (call.statement.match(/\(this:([^ {]+)/) ?? [])[1]?.split('|') ?? [],
      // Builder prefixes property params with the node alias ("this_...")
      params: Object.fromEntries(
        Object.entries(call.params ?? {}).map(([key, value]) => [key.replace(/^this_/, ''), value]),
      ),
    }))
}

/** The relate statements captured by the provider (relationship types are backtick-quoted). */
function relates(provider: FactoryProvider, type: string): CapturedCall[] {
  return provider.txCalls.filter(
    (call) => call.statement.includes('MERGE') && call.statement.includes(`:\`${type}\``),
  )
}

// -----------------------------------------------------------------------------

describe('Neode#factory (NTS-444)', () => {
  let provider: FactoryProvider
  let neode: Neode

  beforeEach(() => {
    provider = new FactoryProvider()
    neode = new Neode(provider)

    emailCounter = 0
    emailFake = () => `user-${++emailCounter}@example.com`
    nicknameValue = 'nick'
  })

  describe('fake precedence', () => {
    it('applies the fake generator when no explicit value or default is given', async () => {
      await neode.factory(SeedPerson).create()

      expect(creates(provider)[0]?.params).toMatchObject({ nickname: 'nick' })
    })

    it('prefers the schema default over fake', async () => {
      await neode.factory(SeedPerson).create()

      expect(creates(provider)[0]?.params).toMatchObject({ city: 'Springfield' })
      expect(creates(provider)[0]?.params).not.toHaveProperty('city', 'Shelbyville')
    })

    it('gives explicit overrides precedence over fake and defaults', async () => {
      await neode.factory(SeedPerson).create({ city: 'Capital', nickname: 'override' })

      expect(creates(provider)[0]?.params).toMatchObject({ city: 'Capital', nickname: 'override' })
    })

    it('applies fake values from the map-based definition path', async () => {
      defineModel('FactoryMapUser', {
        email: { type: 'string', fake: () => 'map@example.com' },
      })

      await neode.factory('FactoryMapUser').create()

      expect(creates(provider)[0]?.params).toMatchObject({ email: 'map@example.com' })
    })
  })

  describe('count', () => {
    it('inserts a single instance without count()', async () => {
      const created = await neode.factory(SeedPerson).create()

      expect(created).toBeInstanceOf(SeedPerson)
      expect(creates(provider)).toHaveLength(1)
    })

    it('inserts n instances with count(n) and resolves to an array', async () => {
      const created = await neode.factory(SeedPerson).count(3).create()

      expect(Array.isArray(created)).toBe(true)
      expect(created).toHaveLength(3)
      expect(creates(provider)).toHaveLength(3)
    })

    it('rejects a non-positive or non-integer count', () => {
      expect(() => neode.factory(SeedPerson).count(0)).toThrow(/count/)
      expect(() => neode.factory(SeedPerson).count(1.5)).toThrow(/count/)
    })
  })

  describe('unique properties', () => {
    it('keeps invoking fake until the values are distinct within the batch', async () => {
      const pool = ['dup@example.com', 'dup@example.com', 'other@example.com']
      emailFake = () => pool.shift() as string

      await neode.factory(SeedPerson).count(2).create()

      const emails = creates(provider).map((create) => create.params['email'])

      expect(emails).toEqual(['dup@example.com', 'other@example.com'])
    })

    it('throws when the fake never produces a distinct value', async () => {
      emailFake = () => 'same@example.com'

      await expect(neode.factory(SeedPerson).count(2).create()).rejects.toThrow(/distinct value/)
    })

    it('lets explicit overrides win over the unique fake without invoking it', async () => {
      const pool: string[] = []
      emailFake = () => pool.shift() as string

      await neode.factory(SeedPerson).create({ email: 'fixed@example.com' })

      expect(pool).toEqual([]) // the fake was never invoked
      expect(creates(provider)[0]?.params).toMatchObject({ email: 'fixed@example.com' })
    })

    it('seeds the used set with an override: later rows fake distinct values around it', async () => {
      const pool = ['fixed@example.com', 'free@example.com']
      emailFake = () => pool.shift() as string

      await neode.factory(SeedPerson).count(2).create({ email: 'fixed@example.com' })

      const emails = creates(provider).map((create) => create.params['email'])

      // Row 1 takes the override; row 2's fake retries past the taken value
      expect(emails).toEqual(['fixed@example.com', 'free@example.com'])
    })
  })

  describe('with()', () => {
    it('creates and relates factory-created target nodes', async () => {
      await neode.factory(SeedPerson).with('posts', { count: 2 }).create()

      const postCreates = creates(provider).filter((create) => create.labels.includes('SeedPost'))

      expect(postCreates).toHaveLength(2)
      expect(relates(provider, 'WROTE')).toHaveLength(2)
    })

    it('passes per-target properties through and supports a function of the index', async () => {
      await neode
        .factory(SeedPerson)
        .with('posts', { count: 2, properties: (index) => ({ title: `Post ${index}` }) })
        .create()

      const titles = creates(provider)
        .filter((create) => create.labels.includes('SeedPost'))
        .map((create) => create.params['title'])

      expect(titles).toEqual(['Post 0', 'Post 1'])
    })

    it('seeds relationships for every created instance', async () => {
      await neode.factory(SeedPerson).count(2).with('posts', { count: 3 }).create()

      expect(creates(provider).filter((create) => create.labels.includes('SeedPost'))).toHaveLength(
        6,
      )
      expect(relates(provider, 'WROTE')).toHaveLength(6)
    })

    it('is chainable across multiple relationship names', async () => {
      defineModel('FactoryLiker', {
        email: { type: 'string', fake: () => 'liker@example.com' },
      })

      defineModel('FactoryPostLikes', {
        labels: ['SeedPost'],
        title: { type: 'string' },
        likedBy: {
          type: 'nodes',
          relationship: 'LIKED',
          direction: 'in',
          target: 'FactoryLiker',
        },
      })

      await neode
        .factory('FactoryPostLikes')
        .with('likedBy', { count: 2 })
        .create({ title: 'Seeded' })

      expect(relates(provider, 'LIKED')).toHaveLength(2)
    })

    it('rejects an unknown relationship name at create time', async () => {
      const builder = neode.factory(SeedPerson).with('unknowns', { count: 1 })

      await expect(builder.create()).rejects.toThrow(/Unknown relationship "unknowns"/)
    })
  })

  describe('make()', () => {
    it('returns an unsaved instance with fakes and defaults resolved', async () => {
      const made = await neode.factory(SeedPerson).make()

      expect(made).toBeInstanceOf(SeedPerson)
      expect(made).toMatchObject({ city: 'Springfield', nickname: 'nick' })
      expect(provider.txCalls).toHaveLength(0) // nothing was persisted
    })

    it('gives overrides precedence without touching the database', async () => {
      const made = await neode.factory(SeedPerson).make({ city: 'Capital' })

      expect(made).toMatchObject({ city: 'Capital', nickname: 'nick' })
      expect(provider.txCalls).toHaveLength(0)
    })

    it('resolves to n unsaved instances with count(n)', async () => {
      const made = await neode.factory(SeedPerson).count(3).make()

      expect(Array.isArray(made)).toBe(true)
      expect(made).toHaveLength(3)
      expect(provider.txCalls).toHaveLength(0)
    })

    it('keeps unique fakes distinct across the batch', async () => {
      const made = (await neode.factory(SeedPerson).count(2).make()) as SeedPerson[]

      expect(made[0]?.email).not.toBe(made[1]?.email)
    })

    it('rejects relationship seeding — unsaved instances cannot be related', async () => {
      await expect(neode.factory(SeedPerson).with('posts', { count: 1 }).make()).rejects.toThrow(
        /use create\(\)/,
      )

      await expect(
        neode.factory(SeedPerson).has(neode.factory(SeedPost), 'posts').make(),
      ).rejects.toThrow(/use create\(\)/)
    })
  })

  describe('has()', () => {
    it('runs the child factory per parent and relates via the explicit relate path', async () => {
      await neode.factory(SeedPerson).has(neode.factory(SeedPost).count(2), 'posts').create()

      const postCreates = creates(provider).filter((create) => create.labels.includes('SeedPost'))

      expect(postCreates).toHaveLength(2)
      expect(relates(provider, 'WROTE')).toHaveLength(2)
    })

    it('runs the child factory once per parent instance', async () => {
      await neode
        .factory(SeedPerson)
        .count(2)
        .has(neode.factory(SeedPost).count(2), 'posts')
        .create()

      const postCreates = creates(provider).filter((create) => create.labels.includes('SeedPost'))

      expect(postCreates).toHaveLength(4)
      expect(relates(provider, 'WROTE')).toHaveLength(4)
    })

    it('composes a single child instance when the child factory has no count()', async () => {
      await neode.factory(SeedPerson).has(neode.factory(SeedPost), 'posts').create()

      expect(creates(provider).filter((create) => create.labels.includes('SeedPost'))).toHaveLength(
        1,
      )
      expect(relates(provider, 'WROTE')).toHaveLength(1)
    })

    it('is chainable alongside with()', async () => {
      await neode
        .factory(SeedPerson)
        .with('posts', { count: 1, properties: { title: 'Via with' } })
        .has(neode.factory(SeedPost).count(1), 'posts')
        .create()

      expect(creates(provider).filter((create) => create.labels.includes('SeedPost'))).toHaveLength(
        2,
      )
      expect(relates(provider, 'WROTE')).toHaveLength(2)
    })

    it('rejects an unknown relationship name', async () => {
      const builder = neode.factory(SeedPerson).has(neode.factory(SeedPost), 'unknowns')

      await expect(builder.create()).rejects.toThrow(/Unknown relationship "unknowns"/)
    })
  })

  describe('validation', () => {
    it('validates fake values like any other create', async () => {
      nicknameValue = 'ab' // shorter than the declared min: 4

      await expect(neode.factory(SeedPerson).create()).rejects.toThrow(ValidationError)
    })

    it('validates pre-generated unique fake values', async () => {
      emailFake = () => 42 as unknown as string // not a string

      await expect(neode.factory(SeedPerson).count(2).create()).rejects.toThrow(ValidationError)
    })

    it('still validates explicit overrides', async () => {
      await expect(neode.factory(SeedPerson).create({ nickname: 'ab' })).rejects.toThrow(
        ValidationError,
      )
    })
  })

  describe('model resolution', () => {
    it('throws the map-registry error for an unknown model name', () => {
      expect(() => neode.factory('Nope')).toThrow(/Couldn't find a definition for "Nope"/)
    })
  })
})
