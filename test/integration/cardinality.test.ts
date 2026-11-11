// NTS-161 — relationship edge ergonomics: write-time cardinality
// (`one` / `zeroOrOne` / `many`) and `syncEdges()` diff-and-apply.
//
// Read paths are untouched: cardinality is a write-path guard (the
// NTS-483 assertWritableDirection precedent) and syncEdges is an
// explicit edge-write API (Eloquent `sync` precedent).
import { openBackend, TestBackend } from './support/backend'
import { InternalId, NodeEntity, OneToMany, OneToOne, String, Uuid } from '../../src/decorators'
import { Direction } from '../../src/query'
import { defineModel } from '../../src/meta/map-schema'
import type { Newable } from '../../src/meta/newable'
import { CardinalityViolationError, NeodeError } from '../../src/errors'
import { EventType } from '../../src/common/events'
import type { QueryExecutedEvent } from '../../src/common/events'
import type { WithMethods } from '../../src/entity-methods'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Role {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  name: string

  static create(name: string): Role {
    const role = new Role()
    role.name = name

    return role
  }
}

@NodeEntity()
class Subscriber {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  name: string

  // 'one' derived from the OneToOne declaration — no explicit cardinality
  @OneToOne({ type: 'ROLE', target: () => Role, direction: Direction.OUTGOING })
  role: Role | undefined

  // explicit zeroOrOne
  @OneToOne({
    type: 'LICENSE',
    target: () => Role,
    direction: Direction.OUTGOING,
    cardinality: 'zeroOrOne',
  })
  license: Role | undefined

  // one, incoming — the guard must count the reverse-stored edges
  @OneToOne({ type: 'MENTOR', target: () => Role, direction: Direction.INCOMING })
  mentor: Role | undefined

  // a many-declared relationship restricted to one edge (NTS-161)
  @OneToMany(() => Role, 'BADGE', Direction.OUTGOING, undefined, undefined, undefined, 'one')
  badge: Role[]

  // many, unrestricted (the today default)
  @OneToMany(() => Role, 'TAGS', Direction.OUTGOING)
  tags: Role[]

  static create(name: string): Subscriber {
    const person = new Subscriber()
    person.name = name

    return person
  }
}

// Map-API parity fixtures: the target is defined first so the
// relationship wires immediately
const MapRole = defineModel('Nts161MapRole', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
})

const MapPerson = defineModel('Nts161MapPerson', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  role: {
    type: 'relationship',
    relationship: 'MAP_ROLE',
    direction: 'out',
    target: 'Nts161MapRole',
    cardinality: 'one',
  },
  many: {
    type: 'relationships',
    relationship: 'MAP_MANY',
    direction: 'out',
    target: 'Nts161MapRole',
  },
})

interface MapInstance {
  name: string
  id?: string
  _id?: string
}

function instance<T>(constructor: Newable): T {
  return new (constructor as new () => T)()
}

// ---------------------------------------------------------------------------

describe('Relationship cardinality (NTS-161)', () => {
  let backend: TestBackend
  let person: Subscriber
  let roleA: Role
  let roleB: Role

  const countEdges = async (type: string): Promise<number> => {
    const result = await backend.neode.readCypher(
      `MATCH (:Subscriber { name: "Adam" })-[r:${type}]->() RETURN count(r) AS c`,
    )

    return Number(result.records[0].get('c'))
  }

  const countEdgesRaw = async (query: string): Promise<number> => {
    const result = await backend.neode.readCypher(query)

    return Number(result.records[0].get('c'))
  }

  beforeAll(async () => {
    backend = await openBackend()
  })

  beforeEach(async () => {
    await backend.clearGraph()

    person = await backend.neode.save(Subscriber.create('Adam'))
    roleA = await backend.neode.save(Role.create('A'))
    roleB = await backend.neode.save(Role.create('B'))
  })

  afterAll(async () => {
    await backend.close()
  })

  it('one: the first relate succeeds and holds exactly one edge', async () => {
    await backend.neode.relate(Subscriber, person, roleA, 'role')

    expect(await countEdges('ROLE')).toBe(1)
  })

  it('one: relating a second target throws CardinalityViolationError naming the relationship and the fix', async () => {
    await backend.neode.relate(Subscriber, person, roleA, 'role')

    const attempt = backend.neode.relate(Subscriber, person, roleB, 'role')

    await expect(attempt).rejects.toBeInstanceOf(CardinalityViolationError)
    await expect(attempt).rejects.toBeInstanceOf(NeodeError)
    await expect(attempt).rejects.toThrow(/"role"/)
    await expect(attempt).rejects.toThrow(/'one'/)
    await expect(attempt).rejects.toThrow(/Detach the existing edge/)

    // Nothing was written
    expect(await countEdges('ROLE')).toBe(1)
  })

  it('one: re-relating the same target is idempotent (MERGE, no second edge)', async () => {
    await backend.neode.relate(Subscriber, person, roleA, 'role')
    await backend.neode.relate(Subscriber, person, roleA, 'role')

    expect(await countEdges('ROLE')).toBe(1)
  })

  it('one: forceCreate cannot duplicate the edge either', async () => {
    await backend.neode.relate(Subscriber, person, roleA, 'role')

    const attempt = backend.neode.relate(Subscriber, person, roleA, 'role', {}, true)

    await expect(attempt).rejects.toBeInstanceOf(CardinalityViolationError)

    expect(await countEdges('ROLE')).toBe(1)
  })

  it('zeroOrOne: accepts zero and one, rejects two', async () => {
    // Zero: the relationship simply holds no edges
    expect(await countEdges('LICENSE')).toBe(0)

    // One
    await backend.neode.relate(Subscriber, person, roleA, 'license')

    expect(await countEdges('LICENSE')).toBe(1)

    // Two
    const attempt = backend.neode.relate(Subscriber, person, roleB, 'license')

    await expect(attempt).rejects.toBeInstanceOf(CardinalityViolationError)
    await expect(attempt).rejects.toThrow(/'zeroOrOne'/)

    expect(await countEdges('LICENSE')).toBe(1)
  })

  it('many: unchanged — two relates give two edges', async () => {
    await backend.neode.relate(Subscriber, person, roleA, 'tags')
    await backend.neode.relate(Subscriber, person, roleB, 'tags')

    expect(await countEdges('TAGS')).toBe(2)
  })

  it('one with an INCOMING direction: the guard counts the reverse-stored edges', async () => {
    await backend.neode.relate(Subscriber, person, roleA, 'mentor')

    // INCOMING stores the edge role -> person
    expect(
      await countEdgesRaw(
        'MATCH (r:Role { name: "A" })-[m:MENTOR]->(:Subscriber) RETURN count(m) AS c',
      ),
    ).toBe(1)

    const attempt = backend.neode.relate(Subscriber, person, roleB, 'mentor')

    await expect(attempt).rejects.toBeInstanceOf(CardinalityViolationError)

    expect(
      await countEdgesRaw('MATCH (r:Role)-[m:MENTOR]->(:Subscriber) RETURN count(m) AS c'),
    ).toBe(1)
  })

  it('create path: saving two targets onto a one-cardinality relationship throws', async () => {
    const before = await backend.neode.readCypher('MATCH (s:Subscriber) RETURN count(s) AS c')

    const draft = Subscriber.create('Crashing')

    draft.badge = [roleA, roleB]

    const attempt = backend.neode.save(draft)

    await expect(attempt).rejects.toBeInstanceOf(CardinalityViolationError)

    // The whole save rolled back — no additional subscriber node was created
    const after = await backend.neode.readCypher('MATCH (s:Subscriber) RETURN count(s) AS c')

    expect(Number(after.records[0].get('c'))).toBe(Number(before.records[0].get('c')))
  })

  it('map API: cardinality one enforced, many the default', async () => {
    const mapPerson = instance<MapInstance>(MapPerson)
    mapPerson.name = 'MapAdam'

    const saved = await backend.neode.save(mapPerson)

    const mapRoleA = instance<MapInstance>(MapRole)
    mapRoleA.name = 'MapA'

    const mapRoleB = instance<MapInstance>(MapRole)
    mapRoleB.name = 'MapB'

    const savedA = await backend.neode.save(mapRoleA)
    const savedB = await backend.neode.save(mapRoleB)

    await backend.neode.relate(MapPerson, saved, savedA, 'role')

    const attempt = backend.neode.relate(MapPerson, saved, savedB, 'role')

    await expect(attempt).rejects.toBeInstanceOf(CardinalityViolationError)

    // The un-cardinalitied many relationship is unchanged
    await backend.neode.relate(MapPerson, saved, savedA, 'many')
    await backend.neode.relate(MapPerson, saved, savedB, 'many')

    const edges = await backend.neode.readCypher(
      'MATCH (:Nts161MapPerson)-[r:MAP_MANY]->() RETURN count(r) AS c',
    )

    expect(Number(edges.records[0].get('c'))).toBe(2)
  })
})

// ---------------------------------------------------------------------------

describe('syncEdges (NTS-161)', () => {
  let backend: TestBackend
  let person: Subscriber
  let roleA: Role
  let roleB: Role
  let roleC: Role

  const events = (): QueryExecutedEvent[] => {
    const collected: QueryExecutedEvent[] = []

    backend.neode.on(EventType.QUERY_EXECUTED, (payload) =>
      collected.push(payload as QueryExecutedEvent),
    )

    return collected
  }

  const relatedNames = async (): Promise<string[]> => {
    const result = await backend.neode.readCypher(
      'MATCH (:Subscriber { name: "Adam" })-[:TAGS]->(r:Role) RETURN r.name AS name ORDER BY name',
    )

    return result.records.map((row) => row.get('name') as string)
  }

  const countEdgesFor = async (type: string): Promise<number> => {
    const result = await backend.neode.readCypher(
      `MATCH (:Subscriber { name: "Adam" })-[r:${type}]->() RETURN count(r) AS c`,
    )

    return Number(result.records[0].get('c'))
  }

  beforeAll(async () => {
    backend = await openBackend()
  })

  beforeEach(async () => {
    await backend.clearGraph()

    person = await backend.neode.save(Subscriber.create('Adam'))
    roleA = await backend.neode.save(Role.create('A'))
    roleB = await backend.neode.save(Role.create('B'))
    roleC = await backend.neode.save(Role.create('C'))

    await backend.neode.relate(Subscriber, person, roleA, 'tags')
  })

  afterAll(async () => {
    await backend.close()
  })

  it('relates missing targets and detaches absent ones', async () => {
    const result = await backend.neode.syncEdges(Subscriber, person, 'tags', [roleB, roleC])

    expect(result).toEqual({ attached: 2, detached: 1 })
    expect(await relatedNames()).toEqual(['B', 'C'])
  })

  it('a no-op sync reports zero changes and issues zero write statements', async () => {
    const collected = events()

    const result = await backend.neode.syncEdges(Subscriber, person, 'tags', [roleA])

    expect(result).toEqual({ attached: 0, detached: 0 })
    expect(await relatedNames()).toEqual(['A'])

    // The only statement is the identity scan (a MATCH) — no writes
    expect(collected.length).toBeGreaterThan(0)

    for (const event of collected) {
      expect(event.cypher).not.toMatch(/MERGE|CREATE|DELETE/)
    }
  })

  it('detaches everything when the target set is empty', async () => {
    const result = await backend.neode.syncEdges(Subscriber, person, 'tags', [])

    expect(result).toEqual({ attached: 0, detached: 1 })
    expect(await relatedNames()).toEqual([])
  })

  it('applies the edge-properties callback to newly related edges only', async () => {
    await backend.neode.syncEdges(Subscriber, person, 'tags', [roleA, roleB], {
      properties: (target) => ({ weight: target === roleB ? 5 : undefined }),
    })

    const edges = await backend.neode.readCypher(
      'MATCH (:Subscriber { name: "Adam" })-[r:TAGS]->(role:Role) RETURN role.name AS name, r.weight AS weight ORDER BY name',
    )

    const byName = Object.fromEntries(
      edges.records.map((row) => [row.get('name') as string, row.get('weight')]),
    )

    // The common edge is untouched (no weight), the new one carries the
    // callback's properties. An absent property reads back null on some
    // backends, undefined on others.
    expect(byName['A'] ?? null).toBeNull()
    expect(byName['B']).toBe(5)
  })

  it('rejects a target set violating the cardinality before any write', async () => {
    await backend.neode.relate(Subscriber, person, roleA, 'role')

    const attempt = backend.neode.syncEdges(Subscriber, person, 'role', [roleB, roleC])

    await expect(attempt).rejects.toBeInstanceOf(CardinalityViolationError)
    await expect(attempt).rejects.toThrow(/"role"/)

    expect(await countEdgesFor('ROLE')).toBe(1)
  })

  it('respects cardinality on a one-relationship replace: detach then relate', async () => {
    await backend.neode.relate(Subscriber, person, roleA, 'role')

    const result = await backend.neode.syncEdges(Subscriber, person, 'role', [roleB])

    expect(result).toEqual({ attached: 1, detached: 1 })
    expect(await countEdgesFor('ROLE')).toBe(1)

    const holder = await backend.neode.readCypher(
      'MATCH (:Subscriber { name: "Adam" })-[:ROLE]->(r:Role) RETURN r.name AS name',
    )

    expect(holder.records[0].get('name')).toBe('B')
  })

  it('joins the ambient transaction and commits with it', async () => {
    await backend.neode.transaction(async (tx) => {
      await tx.syncEdges(Subscriber, person, 'tags', [roleB])

      // The write is visible inside the transaction's own scope
      const inside = await tx.readCypher(
        'MATCH (:Subscriber { name: "Adam" })-[:TAGS]->(r:Role) RETURN r.name AS name',
      )

      expect(inside.records.map((row) => row.get('name'))).toEqual(['B'])
    })

    expect(await relatedNames()).toEqual(['B'])
  })

  it('is mirrored on the entity instance', async () => {
    const result = await (person as WithMethods<Subscriber>).syncEdges('tags', [roleB, roleC])

    expect(result).toEqual({ attached: 2, detached: 1 })
    expect(await relatedNames()).toEqual(['B', 'C'])
  })
})

// ---------------------------------------------------------------------------

describe('replaceRelationship cardinality (NTS-643)', () => {
  let backend: TestBackend
  let person: Subscriber
  let roleA: Role
  let roleB: Role
  let roleC: Role

  const countEdgesFor = async (type: string): Promise<number> => {
    const result = await backend.neode.readCypher(
      `MATCH (:Subscriber { name: "Adam" })-[r:${type}]->() RETURN count(r) AS c`,
    )

    return Number(result.records[0].get('c'))
  }

  beforeAll(async () => {
    backend = await openBackend()
  })

  beforeEach(async () => {
    await backend.clearGraph()

    person = await backend.neode.save(Subscriber.create('Adam'))
    roleA = await backend.neode.save(Role.create('A'))
    roleB = await backend.neode.save(Role.create('B'))
    roleC = await backend.neode.save(Role.create('C'))
  })

  afterAll(async () => {
    await backend.close()
  })

  it('one: a multi-target replace throws CardinalityViolationError naming the relationship', async () => {
    await backend.neode.relate(Subscriber, person, roleA, 'role')

    const attempt = backend.neode.replaceRelationship(person, 'role', [roleB, roleC])

    await expect(attempt).rejects.toBeInstanceOf(CardinalityViolationError)
    await expect(attempt).rejects.toThrow(/"role"/)
    await expect(attempt).rejects.toThrow(/'one'/)

    // Nothing was written — the existing edge survives untouched
    expect(await countEdgesFor('ROLE')).toBe(1)
  })

  it('one: a single-target replace swaps the edge', async () => {
    await backend.neode.relate(Subscriber, person, roleA, 'role')

    await backend.neode.replaceRelationship(person, 'role', [roleB])

    expect(await countEdgesFor('ROLE')).toBe(1)

    const holder = await backend.neode.readCypher(
      'MATCH (:Subscriber { name: "Adam" })-[:ROLE]->(r:Role) RETURN r.name AS name',
    )

    expect(holder.records[0].get('name')).toBe('B')
  })

  it('many: a multi-target replace writes every edge', async () => {
    await backend.neode.replaceRelationship(person, 'tags', [roleA, roleB, roleC])

    expect(await countEdgesFor('TAGS')).toBe(3)
  })
})
