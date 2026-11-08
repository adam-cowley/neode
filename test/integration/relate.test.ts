// The backend import loads neode.service first, resolving the
// query.service -> utils -> neode.service module cycle before the
// query services below are evaluated
import { openBackend, TestBackend } from './support/backend'
import {
  InternalId,
  NodeEntity,
  OneToMany,
  Property,
  RelationshipEntity,
  String,
  Uuid,
} from '../../src/decorators'
import { Direction } from '../../src/query'
import { getModel } from '../../src/meta'
import { EntitySchema } from '../../src/meta/entity/entity-schema'
import { NeodeError } from '../../src/errors'
import { DetachService } from '../../src/services/query/detach.service'
import { RelateService } from '../../src/services/query/relate.service'
import { RelationshipService } from '../../src/services/query/relationship.service'

// ---- Fixtures (per-file: decorator registry is global per module registry) --
//
// Relationship decorators evaluate their target factory eagerly, so classes
// are declared in dependency order: Pet, then Ownership (no @StartNode /
// @EndNode — those would cycle back to Person), then Person.

@NodeEntity()
class Pet {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  name: string

  static create(name: string): Pet {
    const pet = new Pet()
    pet.name = name

    return pet
  }
}

@RelationshipEntity()
class Ownership {
  @InternalId()
  _id: string

  @Property()
  since: string

  @Property({ type: 'number', min: 1 })
  years: number
}

@NodeEntity()
class Person {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  name: string

  @OneToMany(() => Pet, 'OWNS', Direction.OUTGOING)
  pets: Pet[]

  @OneToMany(() => Pet, 'FED_BY', Direction.INCOMING)
  fedBy: Pet[]

  @OneToMany(() => Pet, 'PLAYS_WITH', Direction.BOTH)
  playsWith: Pet[]

  @OneToMany(() => Ownership, 'LEASES', Direction.OUTGOING)
  leases: Ownership[]

  static create(name: string): Person {
    const person = new Person()
    person.name = name

    return person
  }
}

// ---------------------------------------------------------------------------

describe('Relate / detach / relationship services', () => {
  let backend: TestBackend
  let relateService: RelateService
  let detachService: DetachService
  let relationshipService: RelationshipService
  let personSchema: EntitySchema

  const count = async (query: string): Promise<number> => {
    const res = await backend.neode.readCypher(query)

    return Number(res.records[0].get('c'))
  }

  const createFixtures = async () => ({
    adam: await backend.neode.save(Person.create('Adam')),
    rex: await backend.neode.save(Pet.create('Rex')),
  })

  beforeAll(async () => {
    backend = await openBackend()

    relateService = new RelateService(backend.connection)
    detachService = new DetachService(backend.connection)
    relationshipService = new RelationshipService(backend.connection)

    personSchema = getModel(Person)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  describe('RelateService', () => {
    it('relates two nodes with an outgoing relationship', async () => {
      const { adam, rex } = await createFixtures()

      const result = await relateService.relate(
        personSchema,
        adam,
        rex,
        personSchema.getRelationship('pets'),
      )

      expect(result).toBeDefined()
      expect(result!.type).toBe('OWNS')
      expect(result!.elementId).toBeDefined()

      expect(
        await count(
          'MATCH (:Person { name: "Adam" })-[r:OWNS]->(:Pet { name: "Rex" }) RETURN count(r) AS c',
        ),
      ).toBe(1)
      expect(
        await count(
          'MATCH (:Pet { name: "Rex" })-[r:OWNS]->(:Person { name: "Adam" }) RETURN count(r) AS c',
        ),
      ).toBe(0)
    })

    it('stores incoming relationships from the target to the source', async () => {
      const { adam, rex } = await createFixtures()

      await relateService.relate(personSchema, adam, rex, personSchema.getRelationship('fedBy'))

      // DIRECTION_IN inversion: the edge points pet -> person
      expect(
        await count(
          'MATCH (:Pet { name: "Rex" })-[r:FED_BY]->(:Person { name: "Adam" }) RETURN count(r) AS c',
        ),
      ).toBe(1)
      expect(
        await count(
          'MATCH (:Person { name: "Adam" })-[r:FED_BY]->(:Pet { name: "Rex" }) RETURN count(r) AS c',
        ),
      ).toBe(0)
    })

    it('rejects a both direction on write — undirected is match-only (NTS-483)', async () => {
      const { adam, rex } = await createFixtures()

      const attempt = relateService.relate(
        personSchema,
        adam,
        rex,
        personSchema.getRelationship('playsWith'),
      )

      await expect(attempt).rejects.toBeInstanceOf(NeodeError)
      await expect(attempt).rejects.toThrow(/match-only/)
      await expect(attempt).rejects.toThrow(/OUTGOING or INCOMING/)

      // Nothing was written
      expect(
        await count(
          'MATCH (:Person { name: "Adam" })-[r:PLAYS_WITH]-(:Pet { name: "Rex" }) RETURN count(r) AS c',
        ),
      ).toBe(0)
    })

    it('sets properties through the relationship entity schema', async () => {
      const { adam, rex } = await createFixtures()

      const result = await relateService.relate(
        personSchema,
        adam,
        rex,
        personSchema.getRelationship('leases'),
        { since: '2020-01-01', years: '3' },
      )

      expect(result).toBeDefined()
      expect(result!.type).toBe('LEASES')
      expect(result!.properties.since).toBe('2020-01-01')
      // number-typed relationship entity property is converted
      expect(result!.properties.years).toBe(3)
    })

    it('merges by default and creates duplicates with forceCreate', async () => {
      const { adam, rex } = await createFixtures()
      const rel = personSchema.getRelationship('pets')

      await relateService.relate(personSchema, adam, rex, rel)
      await relateService.relate(personSchema, adam, rex, rel)

      expect(
        await count('MATCH (:Person { name: "Adam" })-[r:OWNS]->(:Pet) RETURN count(r) AS c'),
      ).toBe(1)

      await relateService.relate(personSchema, adam, rex, rel, {}, true)

      expect(
        await count('MATCH (:Person { name: "Adam" })-[r:OWNS]->(:Pet) RETURN count(r) AS c'),
      ).toBe(2)
    })

    it('throws when an entity has no primary key value', async () => {
      const { adam, rex } = await createFixtures()

      await expect(
        relateService.relate(personSchema, {} as Person, rex, personSchema.getRelationship('pets')),
      ).rejects.toThrow(/primary key/i)

      await expect(
        relateService.relate(personSchema, adam, {} as Pet, personSchema.getRelationship('pets')),
      ).rejects.toThrow(/primary key/i)
    })
  })

  describe('DetachService', () => {
    it('removes the relationship and returns both re-hydrated nodes', async () => {
      const { adam, rex } = await createFixtures()
      const rel = personSchema.getRelationship('pets')

      await relateService.relate(personSchema, adam, rex, rel)

      const { from, to } = await detachService.detach(personSchema, adam, rex, rel)

      expect(from).toBeInstanceOf(Person)
      expect(from!.name).toBe('Adam')
      expect(to).toBeInstanceOf(Pet)
      expect(to!.name).toBe('Rex')

      expect(
        await count(
          'MATCH (:Person { name: "Adam" })-[r:OWNS]->(:Pet { name: "Rex" }) RETURN count(r) AS c',
        ),
      ).toBe(0)

      // Both nodes survive
      expect(await backend.neode.find(Person, adam.id)).toBeInstanceOf(Person)
      expect(await backend.neode.find(Pet, rex.id)).toBeInstanceOf(Pet)
    })
  })

  describe('RelationshipService', () => {
    it('updates relationship properties by element ID', async () => {
      const { adam, rex } = await createFixtures()

      const rel = await relateService.relate(
        personSchema,
        adam,
        rex,
        personSchema.getRelationship('leases'),
        { since: '2020-01-01', years: 1 },
      )

      const updated = await relationshipService.update(rel!.elementId, {
        since: '2021-06-01',
        years: 2,
      })

      expect(updated!.since).toBe('2021-06-01')
      expect(updated!.years).toBe(2)

      const stored = await backend.neode.readCypher(
        'MATCH ()-[r:LEASES]->() RETURN properties(r) AS p',
      )

      expect(stored.records[0].get('p')).toMatchObject({
        since: '2021-06-01',
        years: 2,
      })
    })

    it('updates relationship properties by property match', async () => {
      const { adam, rex } = await createFixtures()

      await relateService.relate(personSchema, adam, rex, personSchema.getRelationship('leases'), {
        since: '2020-01-01',
      })

      const updated = await relationshipService.update({ since: '2020-01-01' }, { years: 5 })

      expect(updated!.since).toBe('2020-01-01')
      expect(updated!.years).toBe(5)
    })

    it('deletes a relationship by element ID', async () => {
      const { adam, rex } = await createFixtures()

      const rel = await relateService.relate(
        personSchema,
        adam,
        rex,
        personSchema.getRelationship('leases'),
      )

      await relationshipService.delete(rel!.elementId)

      expect(await count('MATCH ()-[r:LEASES]->() RETURN count(r) AS c')).toBe(0)

      // Nodes survive
      expect(await backend.neode.find(Person, adam.id)).toBeInstanceOf(Person)
      expect(await backend.neode.find(Pet, rex.id)).toBeInstanceOf(Pet)
    })
  })
})

// ---- NTS-509: edge-entity property rules validate on the write boundary ----

describe('relationship-entity property validation (NTS-509)', () => {
  let backend: TestBackend
  let relateService: RelateService
  let personSchema: EntitySchema

  beforeAll(async () => {
    backend = await openBackend()

    relateService = new RelateService(backend.connection)

    personSchema = getModel(Person)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('rejects edge properties violating the relationship entity rules', async () => {
    const adam = await backend.neode.save(Person.create('Adam'))
    const rex = await backend.neode.save(Pet.create('Rex'))

    await expect(
      relateService.relate(personSchema, adam, rex, personSchema.getRelationship('leases'), {
        since: '2020-01-01',
        years: 0,
      }),
    ).rejects.toThrow(/validation/i)
  })

  it('accepts valid edge properties (the rules pass through)', async () => {
    const adam = await backend.neode.save(Person.create('Adam'))
    const rex = await backend.neode.save(Pet.create('Rex'))

    const result = await relateService.relate(
      personSchema,
      adam,
      rex,
      personSchema.getRelationship('leases'),
      { since: '2020-01-01', years: 2 },
    )

    expect(result).toBeDefined()
  })
})
