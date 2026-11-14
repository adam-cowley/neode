// support/backend first: it initialises neode.service, breaking the
// utils <-> neode.service circular init that would otherwise surface
// when this file's service imports are evaluated first.
import { openBackend, TestBackend } from './support/backend'
import { setDefaultNeode, type WithMethods } from '../../src/entity-methods'
import { InternalId, NodeEntity, OneToMany, OneToOne, Property, Uuid } from '../../src/decorators'
import { Direction } from '../../src/query'
import { Builder } from '../../src/query/builder'
import { FulltextIndexService } from '../../src/services/schema/fulltext.service'
import { VectorIndexService } from '../../src/services/schema/vector.service'
import { elementIdOfEntity } from '../../src/element-id'
import { getModel } from '../../src/meta'
import { clearFilterParams } from '../../src/index'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Toy {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string
}

@NodeEntity()
class Pet {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string

  // Non-eager: only read when the with-spec requests it
  @OneToMany(() => Toy, 'HAS_TOY', Direction.OUTGOING)
  toys!: Toy[]
}

@NodeEntity()
class Card {
  @Property({ type: 'string', unique: true })
  code!: string
}

@NodeEntity()
class Person {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string

  // Non-eager: only read when the with-spec requests it
  @OneToMany(() => Pet, 'HAS_PET', Direction.OUTGOING)
  pets!: Pet[]

  @OneToOne({ type: 'HAS_CARD', target: () => Card, direction: Direction.OUTGOING })
  card!: Card | undefined
}

/** Full-text + vector probe model (shape: ScoredEntity rows) */
@NodeEntity()
class Doc {
  @InternalId()
  _id!: string

  @Property({ type: 'string', fulltext: true })
  title!: string

  @Property({ type: 'float', array: true })
  emb!: number[]
}

// ---------------------------------------------------------------------------

const DOC_INDEX = 'doc_title_fulltext_b4b713e1'
const DOC_VECTOR = 'doc_emb_vector_d9d13582'

describe('result shape contract (NTS-566) — every read returns the shape', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()

    setDefaultNeode(backend.neode)

    if (backend.capabilities.fulltext) {
      await new FulltextIndexService(backend.connection, [
        { label: 'Doc', properties: ['title'] },
      ]).create()
    }

    if (backend.capabilities.vector) {
      await new VectorIndexService(backend.connection, [
        { label: 'Doc', property: 'emb', dimensions: 3 },
      ]).create()
    }
  })

  afterEach(async () => {
    clearFilterParams()

    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  /** A person with `n` pets (each one toy) and optionally a card, re-found */
  async function seedPerson(petNames: string[], withCard = false): Promise<WithMethods<Person>> {
    const person = await backend.neode.create(Person, { name: `p-${Math.random()}` })

    for (const petName of petNames) {
      const pet = await backend.neode.create(Pet, { name: petName })
      const toy = await backend.neode.create(Toy, { name: `toy-of-${petName}` })

      await backend.neode.relate(Person, person, pet, 'pets')
      await backend.neode.relate(Pet, pet, toy, 'toys')
    }

    if (withCard) {
      const card = await backend.neode.create(Card, { code: `GOLD-${Math.random()}` })

      await backend.neode.relate(Person, person, card, 'card')
    }

    return (await backend.neode.find(Person, person.id)) as WithMethods<Person>
  }

  // ---- Single-entity reads: T | undefined ---------------------------------

  it('find() returns the hydrated entity or undefined', async () => {
    const person = await seedPerson(['Rex'])

    const found = await backend.neode.find(Person, person.id)

    expect(found).toBeInstanceOf(Person)
    expect(found?.name).toBe(person.name)
    expect(await backend.neode.find(Person, 'no-such-id')).toBeUndefined()
  })

  it('findById() returns the hydrated entity or undefined', async () => {
    const person = await seedPerson(['Rex'])

    const id = elementIdOfEntity(getModel(Person), person)
    expect(id).toBeDefined()
    expect(await backend.neode.findById(Person, id as string)).toBeInstanceOf(Person)
    expect(await backend.neode.findById(Person, '4:0:not-a-thing')).toBeUndefined()
  })

  it('find() with a with-spec nests exactly as declared', async () => {
    const person = await seedPerson(['Rex', 'Spot'], true)

    const loaded = await backend.neode.find(Person, person.id, {
      with: { pets: { toys: true }, card: true },
    })

    // many-key: array of entities, each nesting its own declared level
    expect(loaded?.pets).toHaveLength(2)
    expect(loaded?.pets.every((pet) => pet instanceof Pet)).toBe(true)
    expect(loaded?.pets[0]?.toys).toHaveLength(1)
    expect(loaded?.pets[0]?.toys[0]).toBeInstanceOf(Toy)

    // one-key: the entity, or undefined when absent
    expect(loaded?.card).toBeInstanceOf(Card)

    const cardless = await seedPerson([], false)
    const loadedCardless = await backend.neode.find(Person, cardless.id, {
      with: { pets: true, card: true },
    })

    // loaded-and-empty: [] for many, undefined for one
    expect(loadedCardless?.card).toBeUndefined()
    expect(loadedCardless?.pets).toEqual([])
  })

  // ---- List reads: T[] -----------------------------------------------------

  it('all() returns hydrated entities, filtered and ordered', async () => {
    const person = await seedPerson(['Rex', 'Abby', 'Milo'])
    await backend.neode.create(Person, { name: `zz-${person.name}` })

    const pets = await backend.neode.all(Pet, {}, 'name')

    expect(pets).toHaveLength(3)
    expect(pets.every((pet) => pet instanceof Pet)).toBe(true)
    expect(pets.map((pet) => pet.name)).toEqual(['Abby', 'Milo', 'Rex'])
  })

  it('get() / getFirst() / first() return entities', async () => {
    await seedPerson(['Rex', 'Rex-Rival'])

    const pets = await backend.neode.get(Pet, { name: 'Rex' })

    expect(pets).toHaveLength(1)
    expect(pets[0]).toBeInstanceOf(Pet)

    const one = await backend.neode.get(Person, {}, 1)
    expect(one).toHaveLength(1)
    expect(one[0]).toBeInstanceOf(Person)

    expect(await backend.neode.getFirst(Pet, { name: 'nope' })).toBeUndefined()

    const first = await backend.neode.first(Pet, 'name', 'Rex')
    expect(first).toBeInstanceOf(Pet)
  })

  it('findManyAndCount() returns { items, total }', async () => {
    await seedPerson(['Rex', 'Abby'])

    const result = await backend.neode.findManyAndCount(Pet, {})

    expect(Object.keys(result).sort()).toEqual(['items', 'total'])
    expect(result.total).toBe(2)
    expect(result.items).toHaveLength(2)
    expect(result.items.every((pet) => pet instanceof Pet)).toBe(true)
  })

  // ---- Pagination ----------------------------------------------------------

  it('paginate() offset mode returns { items, total, page, limit, totalPages }', async () => {
    await seedPerson(['Rex', 'Abby', 'Milo'])

    const page = await backend.neode.paginate(Pet, {}, { page: 1, limit: 2, order: 'name' })

    expect(Object.keys(page).sort()).toEqual(['items', 'limit', 'page', 'total', 'totalPages'])
    expect(page.items).toHaveLength(2)
    expect(page.items.every((pet) => pet instanceof Pet)).toBe(true)
    expect(page.total).toBe(3)
    expect(page.totalPages).toBe(2)
  })

  it('paginate() cursor mode returns { items, nextCursor, hasMore }', async () => {
    await seedPerson(['Rex', 'Abby', 'Milo'])

    const page = await backend.neode.paginate(Pet, {}, { limit: 2, orderBy: 'name' })

    expect(Object.keys(page).sort()).toEqual(['hasMore', 'items', 'nextCursor'])
    expect(page.items).toHaveLength(2)
    expect(page.items.every((pet) => pet instanceof Pet)).toBe(true)
    expect(page.hasMore).toBe(true)
    expect(typeof page.nextCursor).toBe('string')
  })

  it('chunk() delivers entity pages; lazy() yields entities', async () => {
    await seedPerson(['Rex', 'Abby', 'Milo'])

    const pages: Pet[][] = []

    const delivered = await backend.neode.chunk(
      Pet,
      {},
      2,
      (items) => {
        pages.push(items as Pet[])
      },
      { orderBy: 'name' },
    )

    expect(delivered).toBe(3)
    expect(pages).toHaveLength(2)
    expect(pages[0]?.every((pet) => pet instanceof Pet)).toBe(true)

    const seen: unknown[] = []

    for await (const pet of backend.neode.lazy(Pet, {}, { limit: 2, orderBy: 'name' })) {
      seen.push(pet)
    }

    expect(seen).toHaveLength(3)
    expect(seen.every((pet) => pet instanceof Pet)).toBe(true)
  })

  // ---- Per-instance loads --------------------------------------------------

  it('load(key) materializes many as an array and one as entity-or-undefined', async () => {
    const person = await seedPerson(['Rex', 'Spot'], true)

    const pets = await person.load('pets')
    expect(Array.isArray(pets)).toBe(true)
    expect((pets as Pet[]).every((pet) => pet instanceof Pet)).toBe(true)
    expect(person.pets).toBe(pets)

    const card = await person.load('card')
    expect(card).toBeInstanceOf(Card)
    expect(person.card).toBe(card)
  })

  it('load(spec) materializes every requested level on the instance', async () => {
    const person = await seedPerson(['Rex'])

    await person.load({ pets: { toys: true } })

    expect(person.pets).toHaveLength(1)
    expect(person.pets[0]).toBeInstanceOf(Pet)
    expect(person.pets[0]?.toys).toHaveLength(1)
    expect(person.pets[0]?.toys[0]).toBeInstanceOf(Toy)
  })

  // ---- related() scope -----------------------------------------------------

  it('related().find()/first()/count() return entities and numbers', async () => {
    const person = await seedPerson(['Rex', 'Spot'], true)
    const cardless = await seedPerson(['Rex'])

    const pets = await person.related('pets').orderBy('name').find()
    expect(pets.map((pet) => pet.name)).toEqual(['Rex', 'Spot'])

    const first = await person.related('pets').first()
    expect(first).toBeInstanceOf(Pet)

    expect(await person.related('pets').count()).toBe(2)

    // An empty traversal reads as the empty shape, not an error
    expect(await cardless.related('card').count()).toBe(0)
  })

  it('related().withRelationship() returns { node, edge } rows', async () => {
    const person = await seedPerson(['Rex'], true)

    // many-key: RelationshipEdgeRead<Pet>[]
    const rows = await person.related('pets').withRelationship().find()

    expect(rows).toHaveLength(1)
    expect(rows[0]?.node).toBeInstanceOf(Pet)
    expect(rows[0]?.edge.type).toBe('HAS_PET')
    expect(typeof rows[0]?.edge.elementId).toBe('string')

    // one-key cardinality: RelationshipEdgeRead<Card> | undefined
    const cardRow = await person.related('card').withRelationship().first()
    expect(cardRow).toBeDefined()
    expect(cardRow?.node).toBeInstanceOf(Card)

    const cardless = await seedPerson(['Rex'])
    const none = await cardless.related('card').withRelationship().find()
    expect(none).toBeUndefined()
  })

  // ---- Repository reads ----------------------------------------------------

  it('repository find/findBy/findAll/where return entities', async () => {
    await seedPerson(['Rex', 'Abby'])

    // The seeded PETS carry the declared names
    const repository = backend.neode.getRepository(Pet)

    const found = await repository.findAll({}, { order: 'name', limit: 1 })
    expect(found).toHaveLength(1)
    expect(found[0]).toBeInstanceOf(Pet)

    const byName = await repository.findBy({ name: 'Rex' })
    expect(byName).toBeInstanceOf(Pet)

    const where = await repository.where()
    expect(where).toHaveLength(2)
    expect(where.every((pet) => pet instanceof Pet)).toBe(true)

    expect(await repository.find('no-such-id')).toBeUndefined()
  })

  it('repository findAll hydrates an eager model through the local path', async () => {
    // Map-defined model with a STATIC eager relationship: the repository's
    // local Builder path returns the eager projection map — it must hydrate
    // exactly like the facade's reads (shape.ts alignment)
    backend.neode.with({
      ShapeRepoOwner: {
        id: { type: 'uuid', primary: true },
        name: { type: 'string' },
        pets: {
          type: 'relationship',
          relationship: 'SHAPE_REPO_PET',
          direction: 'out',
          target: 'ShapeRepoPet',
          eager: true,
        },
      },
      ShapeRepoPet: {
        id: { type: 'uuid', primary: true },
        name: { type: 'string' },
      },
    })

    const Owner = backend.neode.model('ShapeRepoOwner')
    const PetModel = backend.neode.model('ShapeRepoPet')

    const owner = await backend.neode.create(Owner, { name: 'adam' })
    const pet = await backend.neode.create(PetModel, { name: 'rex' })
    await backend.neode.relate(Owner, owner, pet, 'pets')

    const repository = backend.neode.getRepository(Owner)

    const owners = await repository.findAll()

    expect(owners).toHaveLength(1)

    // Map schemas declare no cardinality: the eager relationship hydrates
    // singular (the same shape the facade's all() returns)
    const loaded: unknown = (owners[0] as Record<string, unknown>)['pets']
    expect(loaded).toBeInstanceOf(PetModel)
    expect((loaded as Record<string, unknown>)['name']).toBe('rex')
  })

  // ---- Raw paths -----------------------------------------------------------

  it('cypher() returns raw JSON-safe records; with hydrate, entities', async () => {
    await seedPerson(['Rex'])

    const raw = await backend.neode.cypher('MATCH (p:Person) RETURN p AS this LIMIT 1')

    expect(raw.records).toHaveLength(1)
    const value: unknown = raw.records[0]?.get('this')
    // JSON-safe: a plain node shape, not a driver class
    expect(value).toMatchObject({ properties: {} })

    const hydrated = await backend.neode.cypher(
      'MATCH (p:Person) RETURN p AS this LIMIT 1',
      {},
      { hydrate: Person },
    )

    expect(hydrated).toHaveLength(1)
    expect(hydrated[0]).toBeInstanceOf(Person)
  })

  it('read() with the hydrate option hydrates the alias column', async () => {
    await seedPerson(['Rex'])

    const hydrated = await backend.neode.read('MATCH (p:Person) RETURN p AS this', {
      hydrate: Person,
    })

    expect(hydrated).toHaveLength(1)
    expect(hydrated[0]).toBeInstanceOf(Person)

    const built = await backend.neode.read(new Builder().match('p', ['Pet']).return('p AS this'), {
      hydrate: Pet,
    })

    expect(built).toHaveLength(1)
    expect(built[0]).toBeInstanceOf(Pet)
  })

  // ---- Scored reads --------------------------------------------------------

  it('search() returns { entity, score } rows, best match first', async () => {
    if (!backend.capabilities.fulltext) {
      return
    }

    await backend.connection.run(
      "CREATE (:Doc {title: 'The Matrix screenplay', emb: [1.0, 0.0, 0.0]})",
    )
    await backend.connection.run("CREATE (:Doc {title: 'A cookbook', emb: [0.0, 1.0, 0.0]})")

    const results = await backend.neode.search(Doc, DOC_INDEX, 'matrix')

    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]?.entity).toBeInstanceOf(Doc)
    expect(typeof results[0]?.score).toBe('number')
    for (const [index, result] of results.entries()) {
      if (index > 0) {
        expect(results[index - 1]?.score).toBeGreaterThanOrEqual(result.score)
      }
    }
  })

  it('knn() returns { entity, score } rows, best match first', async () => {
    if (!backend.capabilities.vector) {
      return
    }

    await backend.connection.run("CREATE (:Doc {title: 'near', emb: [1.0, 0.0, 0.0]})")
    await backend.connection.run("CREATE (:Doc {title: 'far', emb: [0.0, 1.0, 0.0]})")

    const results = await backend.neode.knn(Doc, DOC_VECTOR, [1, 0.1, 0], 2)

    expect(results).toHaveLength(2)
    expect(results[0]?.entity).toBeInstanceOf(Doc)
    expect((results[0]?.entity as Doc).title).toBe('near')
    expect(results[0]?.score).toBeGreaterThanOrEqual(results[1]?.score ?? 0)
  })
})
