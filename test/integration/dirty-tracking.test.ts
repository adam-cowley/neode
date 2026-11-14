// The backend import loads neode.service first, resolving the
// query.service -> utils -> neode.service module cycle before the
// query services below are evaluated
import { openBackend, TestBackend } from './support/backend'
import { setDefaultNeode } from '../../src/entity-methods'
import { EventType, QueryExecutedEvent } from '../../src/common/events'
import {
  Hidden,
  InternalId,
  NodeEntity,
  Number,
  OneToMany,
  OnMatchSet,
  Property,
  Protected,
  Readonly,
  Uuid,
} from '../../src/decorators'
import { Direction } from '../../src/query'

// ---- Fixtures (per-file: decorator registry is global per module) -----------

@NodeEntity()
class DirtyPet {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string
}

@NodeEntity()
class DirtyPerson {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string

  @Number()
  age: number

  @Property({ type: 'string' })
  @Readonly()
  species: string

  @Property({ type: 'string' })
  @Protected()
  password: string

  @Property({ type: 'string' })
  @Hidden()
  secret: string

  @Property({ type: 'string' })
  @OnMatchSet()
  seen: string

  @Property({ type: 'string', onCreateSet: true, alwaysSet: true })
  badge: string

  @OneToMany(() => DirtyPet, 'OWNS', Direction.OUTGOING, true)
  pets: DirtyPet[]
}

// ---------------------------------------------------------------------------

describe('instance dirty tracking (NTS-157)', () => {
  let backend: TestBackend
  let queries: QueryExecutedEvent[]

  const mergeQueries = (): QueryExecutedEvent[] =>
    queries.filter((event) => event.cypher.includes('MERGE (this:'))

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

  const createPerson = (): Promise<DirtyPerson> =>
    backend.neode.create(DirtyPerson, {
      name: 'Adam',
      age: 30,
      species: 'human',
      password: 'pw',
      secret: 'sec',
      seen: 'seen-at-create',
      badge: 'badge-at-create',
    })

  it('a clean instance save() is a no-op: no query, no lifecycle events', async () => {
    const person = await createPerson()

    queries.length = 0

    const saved = await person.save()

    expect(queries).toHaveLength(0)
    expect(saved).toBe(person)
    expect(person.isDirty()).toBe(false)
    expect(person.wasChanged()).toBe(false)
  })

  it('a clean instance save() emits no NODE_UPDATED event', async () => {
    const person = await createPerson()

    const updated: unknown[] = []
    const onUpdate = (entity: unknown): void => {
      updated.push(entity)
    }

    backend.neode.on(EventType.NODE_UPDATED, onUpdate)

    await person.save()

    expect(updated).toHaveLength(0)

    backend.neode.off(EventType.NODE_UPDATED, onUpdate)
  })

  it('a dirty save() writes only the dirty properties — a second stale instance of the same node cannot clobber them', async () => {
    const created = await createPerson()

    // Two independent hydrated views of the same node
    const a = (await backend.neode.find(DirtyPerson, created.id)) as DirtyPerson
    const b = (await backend.neode.find(DirtyPerson, created.id)) as DirtyPerson

    a['name'] = 'Ada'
    await a.save()

    queries.length = 0

    // b is stale (name: 'Adam'); only its age is dirty
    b['age'] = 31
    await b.save()

    const [statement] = mergeQueries()

    // The partial SET carries age only — not the clean (stale) name
    expect(statement?.cypher).toContain('SET this.age')
    expect(statement?.cypher).not.toContain('SET this.name')

    const final = (await backend.neode.find(DirtyPerson, created.id)) as DirtyPerson

    expect(final?.['name']).toBe('Ada')
    expect(final?.['age']).toBe(31)
  })

  it('a save() after a dirty save() is clean again', async () => {
    const person = await createPerson()

    person['name'] = 'Ada'
    await person.save()

    expect(person.isDirty()).toBe(false)
    expect(person.wasChanged('name')).toBe(true)

    queries.length = 0

    await person.save()

    expect(queries).toHaveLength(0)
  })

  it('getDirty() reports the pending changes and never relationship keys', async () => {
    const person = await createPerson()

    person['name'] = 'Ada'
    person['age'] = 31
    person['pets'] = []

    expect(person.getDirty()).toEqual({ name: 'Ada', age: 31 })
  })

  it('update() with no arguments flushes the dirty properties', async () => {
    const person = await createPerson()

    person['name'] = 'Ada'
    person['age'] = 31

    await person.update()

    const found = (await backend.neode.find(DirtyPerson, person.id)) as DirtyPerson

    expect(found?.['name']).toBe('Ada')
    expect(found?.['age']).toBe(31)
    expect(person.isDirty()).toBe(false)
    expect(person.wasChanged('name')).toBe(true)
    expect(person.wasChanged('age')).toBe(true)
    expect(person.wasChanged('species')).toBe(false)
  })

  it('update() with no arguments on a clean instance runs no query', async () => {
    const person = await createPerson()

    queries.length = 0

    await person.update()

    expect(queries).toHaveLength(0)
  })

  it('update() with explicit properties writes those keys only', async () => {
    const person = await createPerson()

    person['name'] = 'Ada'
    await person.update({ age: 33 })

    const found = (await backend.neode.find(DirtyPerson, person.id)) as DirtyPerson

    expect(found?.['age']).toBe(33)
    expect(found?.['name']).toBe('Adam')
    expect(person.wasChanged('age')).toBe(true)
    expect(person.wasChanged('name')).toBe(false)
  })

  it('a readonly property is written by save() (upsert semantics) but never by update()', async () => {
    const person = await createPerson()

    person['species'] = 'alien'
    await person.save()

    const afterSave = (await backend.neode.find(DirtyPerson, person.id)) as DirtyPerson

    expect(afterSave?.['species']).toBe('alien')

    afterSave['species'] = 'another'
    await afterSave.update({ species: 'another' })

    const afterUpdate = (await backend.neode.find(DirtyPerson, person.id)) as DirtyPerson

    expect(afterUpdate?.['species']).toBe('alien')
  })

  it('a readonly mutation flushed by update() is not written', async () => {
    const person = await createPerson()

    person['species'] = 'alien'
    await person.update()

    const found = (await backend.neode.find(DirtyPerson, person.id)) as DirtyPerson

    expect(found?.['species']).toBe('human')
  })

  it('protected and hidden properties are tracked and written; hidden stays excluded from toJson()', async () => {
    const person = await createPerson()

    person['password'] = 'new-pw'
    person['secret'] = 'new-secret'

    expect(person.getDirty()).toEqual({ password: 'new-pw', secret: 'new-secret' })

    await person.save()

    const found = (await backend.neode.find(DirtyPerson, person.id)) as DirtyPerson

    expect(found?.['password']).toBe('new-pw')
    expect(found?.['secret']).toBe('new-secret')
    // toJson excludes hidden (and structural) properties only — protected
    // guards the update write path, not the serialisation
    expect(found.toJson()).not.toHaveProperty('secret')
  })

  it('a dirty onMatchSet property flows into the ON MATCH SET clause', async () => {
    const person = await createPerson()

    person['seen'] = 'seen-just-now'
    await person.save()

    const [statement] = mergeQueries()

    expect(statement?.cypher).toContain('ON MATCH SET this.seen')

    const found = (await backend.neode.find(DirtyPerson, person.id)) as DirtyPerson

    expect(found?.['seen']).toBe('seen-just-now')
  })

  it('a dirty alwaysSet property flows into the plain SET clause (written on match)', async () => {
    const person = await createPerson()

    person['badge'] = 'new-badge'
    await person.save()

    const [statement] = mergeQueries()

    // onCreateSet also renders its ON CREATE SET line; the alwaysSet flag
    // forces the plain SET through, so the value is written on match too
    expect(statement?.cypher).toContain('SET this.badge')
    expect(statement?.cypher).not.toContain('MATCH SET this.badge')

    const found = (await backend.neode.find(DirtyPerson, person.id)) as DirtyPerson

    expect(found?.['badge']).toBe('new-badge')
  })

  it('a dirty save() never walks the graph — eager relationship values are not re-related', async () => {
    const person = await createPerson()
    const pet = await backend.neode.create(DirtyPet, { name: 'Rex' })

    await person.relateTo(pet, 'pets')

    // Re-hydrate WITH the eager pets value on the instance — the shape
    // that a full save() would re-relate
    const eager = (await backend.neode.find(DirtyPerson, person.id)) as DirtyPerson

    expect(eager['pets']).toHaveLength(1)

    queries.length = 0

    eager['name'] = 'Ada'
    await eager.save()

    // Exactly the partial-SET merge and its re-find: no pet merge, no
    // relationship writes (the re-find's eager OWNS read is fine)
    expect(queries).toHaveLength(2)
    expect(mergeQueries()).toHaveLength(1)
    expect(mergeQueries()[0]?.cypher.includes('OWNS')).toBe(false)

    const found = (await backend.neode.find(DirtyPerson, person.id)) as DirtyPerson

    expect(found?.['name']).toBe('Ada')
    expect(found?.['pets']).toHaveLength(1)
  })
})
