import { NodeEntity, Uuid, Property, Number, InternalId } from '../../src/decorators'
import { getModel } from '../../src/meta'
import { getMergeFields } from '../../src/services/query/merge.service'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Account {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string

  @Property({ type: 'string' })
  email: string

  @Number()
  age: number

  static create(name: string, email?: string, age?: number): Account {
    const account = new Account()
    account.name = name

    if (email !== undefined) {
      account.email = email
    }

    if (age !== undefined) {
      account.age = age
    }

    return account
  }
}

@NodeEntity()
class Tag {
  @InternalId()
  _id: string

  @Property({ type: 'string', index: true })
  slug: string

  static create(slug: string): Tag {
    const tag = new Tag()
    tag.slug = slug

    return tag
  }
}

// ---------------------------------------------------------------------------

describe('mergeOn', () => {
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

  it('merges an existing node matched by unique property and sets the given properties', async () => {
    const saved = await backend.neode.save(Account.create('Adam'))

    const merged = (
      await backend.neode.mergeOn(Account, { name: 'Adam' }, { email: 'adam@example.com', age: 30 })
    )?.entity

    expect(merged).toBeInstanceOf(Account)
    expect(merged!._id).toBe(saved._id)
    expect(merged!.email).toBe('adam@example.com')
    expect(merged!.age).toBe(30)
    expect(merged!.name).toBe('Adam')
  })

  it('creates a node when no match exists, with both match and set properties', async () => {
    const merged = (
      await backend.neode.mergeOn(Account, { name: 'Ada' }, { email: 'ada@example.com' })
    )?.entity

    const found = await backend.neode.find(Account, merged!.id)

    expect(found).toBeInstanceOf(Account)
    expect(found!.name).toBe('Ada')
    expect(found!.email).toBe('ada@example.com')
  })

  it('returns a hydrated instance of the entity class', async () => {
    const merged = (await backend.neode.mergeOn(Account, { name: 'Alan' }, { age: 40 }))?.entity

    expect(merged).toBeInstanceOf(Account)
    expect(merged!.name).toBe('Alan')
    expect(merged!.age).toBe(40)
    expect(merged!._id).toBeDefined()
    expect(merged!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('throws on an empty match', async () => {
    await expect(backend.neode.mergeOn(Account, {}, { email: 'x@example.com' })).rejects.toThrow(
      /match/i,
    )
  })

  describe('mergeFields', () => {
    it('includes unique and indexed properties', () => {
      const fields = getMergeFields(getModel(Account)).map((property) => property.getKey())

      // id is a primary key (which implies unique)
      expect(fields).toEqual(expect.arrayContaining(['id', 'name']))
      expect(fields).not.toContain('email')
    })

    it('merges on an indexed property when the model has no unique properties', async () => {
      const first = await backend.neode.save(Tag.create('first-post'))
      const second = await backend.neode.save(Tag.create('another-post'))

      expect(second._id).not.toBe(first._id)

      // Re-merging the same slug matches the existing node
      const again = await backend.neode.save(Tag.create('first-post'))

      expect(again._id).toBe(first._id)
    })
  })
})
