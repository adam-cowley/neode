import {
  NodeEntity,
  Uuid,
  Number,
  InternalId,
  Property,
  OneToMany,
  RelationshipEntity,
  StartNode,
  EndNode,
} from '../../src/decorators'
import { Direction } from '../../src/query'
import { mergeRelationshipProperty } from '../../src/meta'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --
// Decorator targets resolve eagerly, so back-references (Person -> Membership)
// are registered through the metamodel after both classes exist.

@NodeEntity()
class Post {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  title: string
}

@NodeEntity()
class Team {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string
}

@NodeEntity()
class Person {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string

  @Number()
  age: number

  @OneToMany(() => Post, 'WROTE', Direction.OUTGOING)
  posts: Post[]
}

@RelationshipEntity()
class Membership {
  @InternalId()
  _id: string

  @Property()
  role: string

  @StartNode(() => Person)
  person: Person

  @EndNode(() => Team)
  team: Team
}

mergeRelationshipProperty(Person, 'memberships', 'MEMBER_OF', Membership, Direction.OUTGOING, true)

@NodeEntity()
class ChainNode {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @OneToMany(() => ChainNode, 'NEXT', Direction.OUTGOING)
  next: ChainNode
}

// A relationship entity without a @StartNode/@EndNode property: creating
// through it must fail cleanly inside the transaction
@RelationshipEntity()
class BrokenMembership {
  @Property()
  role: string
}

@NodeEntity()
class BrokenPerson {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string

  @OneToMany(() => BrokenMembership, 'BROKEN', Direction.OUTGOING)
  memberships: BrokenMembership[]
}

// ---------------------------------------------------------------------------

describe('create', () => {
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

  it('creates an entity with properties and a uuid default', async () => {
    const created = await backend.neode.create(Person, {
      name: 'Adam',
      age: 30,
    })

    expect(created).toBeInstanceOf(Person)
    expect(created.name).toBe('Adam')
    expect(created.age).toBe(30)
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(created._id).toBeDefined()

    const found = await backend.neode.find(Person, created.id)

    expect(found).toBeInstanceOf(Person)
    expect(found!.name).toBe('Adam')
    expect(found!.age).toBe(30)
  })

  it('creates and relates nested one-to-many node targets', async () => {
    const created = await backend.neode.create(Person, {
      name: 'Adam',
      posts: [{ title: 'First Post' }, { title: 'Second Post' }],
    })

    expect(created).toBeInstanceOf(Person)
    expect(created.name).toBe('Adam')

    const related = await backend.neode.readCypher(
      'MATCH (p:Person { name: $name })-[:WROTE]->(post:Post) ' +
        'RETURN post.title AS title ORDER BY title',
      { name: 'Adam' },
    )

    expect(related.records).toHaveLength(2)
    expect(related.records[0].get('title')).toBe('First Post')
    expect(related.records[1].get('title')).toBe('Second Post')
  })

  it('creates a nested relationship entity target between its nodes', async () => {
    const created = await backend.neode.create(Person, {
      name: 'Adam',
      memberships: [{ role: 'admin', team: { name: 'Engineering' } }],
    })

    expect(created).toBeInstanceOf(Person)

    const related = await backend.neode.readCypher(
      'MATCH (p:Person { name: $name })-[m:MEMBER_OF]->(t:Team) ' +
        'RETURN m.role AS role, t.name AS team',
      { name: 'Adam' },
    )

    expect(related.records).toHaveLength(1)
    expect(related.records[0].get('role')).toBe('admin')
    expect(related.records[0].get('team')).toBe('Engineering')
  })

  it('stops nesting at the depth cap instead of recursing forever', async () => {
    // A chain of 120 nested targets: one deeper than the cap allows
    let nested: Record<string, unknown> = {}

    for (let i = 0; i < 120; i++) {
      nested = { next: nested }
    }

    const created = await backend.neode.create(ChainNode, nested)

    expect(created).toBeInstanceOf(ChainNode)

    // Depths 0-99 are created (the root plus one per cap level); the
    // remaining 20 links are dropped
    const nodes = await backend.neode.get(ChainNode, {})

    expect(nodes).toHaveLength(100)
  })

  it('commits and leaves no open transactions', async () => {
    const created = await backend.neode.create(Person, { name: 'TxCreate' })

    // Visible outside the creation transaction: it was committed
    const found = await backend.neode.find(Person, created.id)

    expect(found).toBeInstanceOf(Person)
    expect(found!.name).toBe('TxCreate')
  })

  it('rolls back a failed creation and leaves no open transactions', async () => {
    await expect(
      backend.neode.create(BrokenPerson, {
        name: 'Broken',
        memberships: [{ role: 'admin' }],
      }),
    ).rejects.toThrow(/@StartNode or @EndNode/i)

    // Nothing partial was persisted
    const found = await backend.neode.getFirst(BrokenPerson, { name: 'Broken' })

    expect(found).toBeUndefined()

    // The connection is back in a clean state: a new transaction can begin
    const next = await backend.neode.create(Person, { name: 'AfterFailure' })

    expect(next).toBeInstanceOf(Person)
  })
})
