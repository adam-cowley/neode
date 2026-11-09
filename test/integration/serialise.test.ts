import {
  NodeEntity,
  Protected,
  Uuid,
  String,
  InternalId,
  Date,
  DateTime,
  Duration,
  Point,
  OneToMany,
  Filter,
} from '../../src/decorators'
import { Direction } from '../../src/query'
import { clearFilterParams, setFilterParams } from '../../src/index'
import { Collection } from '../../src/collection'
import { toJson } from '../../src/serialise'
import { NeodeError } from '../../src/errors'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Place {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  name: string

  @Date()
  founded: string

  @DateTime()
  createdAt: string

  @Duration()
  travel: { months: number; days: number; seconds: number; nanoseconds: number }

  @Point()
  location: { x: number; y: number }

  @String({ hidden: true })
  secret: string

  @OneToMany(() => Place, 'NEAR', Direction.OUTGOING, true)
  near: Place[]

  static build(values: Partial<Place>): Place {
    return Object.assign(new Place(), values) as unknown as Place
  }
}

@NodeEntity()
class Landmark {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  name: string

  @OneToMany(() => Landmark, 'NEARBY', Direction.OUTGOING)
  nearby: Landmark[]

  @OneToMany(() => Landmark, 'VIEW_OF', Direction.OUTGOING)
  views: Landmark[]

  static build(values: Partial<Landmark>): Landmark {
    return Object.assign(new Landmark(), values) as unknown as Landmark
  }
}

// NTS-564: the filtered-relation fixture — the gates carry the named
// filter, the site reads them eagerly, a fully filtered-out relation
// hydrates to the loaded-and-empty shape
@NodeEntity()
@Filter({ name: 'gate_tenant', where: 'node.tenant = $gate_tenant' })
class Gate {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String()
  name: string

  @String()
  tenant: string

  static build(values: Partial<Gate>): Gate {
    return Object.assign(new Gate(), values) as unknown as Gate
  }
}

@NodeEntity()
class GuardedSite {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  name: string

  @OneToMany(() => Gate, 'GATE_OF', Direction.INCOMING, true)
  gates: Gate[]

  static build(values: Partial<GuardedSite>): GuardedSite {
    return Object.assign(new GuardedSite(), values) as unknown as GuardedSite
  }
}

// NTS-597: the protected field never serialises, even hydrated
@NodeEntity()
class Guarded597Place {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  name: string

  @String()
  @Protected()
  password: string

  static build(values: Partial<Guarded597Place>): Guarded597Place {
    return Object.assign(new Guarded597Place(), values) as unknown as Guarded597Place
  }
}

// ---------------------------------------------------------------------------

describe('toJson round-trip (serialisation)', () => {
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

  it('serialises saved entities with temporal, duration and point properties', async () => {
    await backend.neode.save(
      Place.build({
        name: 'London',
        secret: 'hidden-value',
      }),
    )

    // neode's save path cannot yet pass driver temporal/point params
    // through the Relate FFI (known Phase-4 gap in property conversion),
    // so the complex values are written with native Cypher functions on
    // the saved node — hydration + serialisation is what this phase owns.
    await backend.connection.run(`
            MATCH (p:Place {name: 'London'})
            SET p += {
                founded: date('2024-03-15'),
                createdAt: datetime('2024-03-15T10:00:00Z'),
                travel: duration({days: 1}),
                location: point({x: 1, y: 2})
            }
        `)

    const found = await backend.neode.getFirst<Place>(Place, { name: 'London' })

    expect(found).toBeDefined()

    const output = toJson(found)

    expect(output._labels).toEqual(['Place'])
    expect(typeof output._id).toBe('string')
    expect(output._id).toBe(found!._id)
    expect(output.name).toBe('London')
    expect(output.founded).toBe('2024-03-15')
    expect(output.createdAt).toBe('2024-03-15T10:00:00Z')
    expect(output.travel).toBe('P0M1DT0S')
    expect(output.location).toEqual({ srid: 7203, x: 1, y: 2 })

    // Hidden properties are not serialised
    expect(output).not.toHaveProperty('secret')

    // Unset relationships are not serialised: an eagerly loaded
    // relationship with no results serialises to an empty array
    expect(output.near).toEqual([])

    // The output is JSON friendly end to end
    const roundTripped = JSON.parse(JSON.stringify(output)) as Record<string, unknown>

    expect(roundTripped.founded).toBe('2024-03-15')
    expect(roundTripped.location).toEqual({ srid: 7203, x: 1, y: 2 })
  })

  // NTS-597: protected properties do not serialise
  it('omits protected properties from the serialised output', async () => {
    await backend.neode.save(Guarded597Place.build({ name: 'Vault', password: 'hush' }))

    const found = await backend.neode.getFirst<Guarded597Place>(Guarded597Place, {
      name: 'Vault',
    })

    expect(found).toBeDefined()

    // the protected value hydrates onto the instance…
    expect(found!['password']).toBe('hush')

    const output = toJson(found)

    // …but never serialises
    expect(output.name).toBe('Vault')
    expect(output).not.toHaveProperty('password')
  })

  it('serialises nested eager relationships as entities', async () => {
    await backend.neode.save(Place.build({ name: 'London' }))
    await backend.neode.save(Place.build({ name: 'Paris' }))

    await backend.connection.run(
      'MATCH (a:Place {name: $from}), (b:Place {name: $to}) CREATE (a)-[:NEAR]->(b)',
      { from: 'London', to: 'Paris' },
    )

    const found = await backend.neode.getFirst<Place>(Place, { name: 'London' })

    const output = toJson(found)

    const near = output.near as Record<string, unknown>[]

    expect(near).toEqual([expect.objectContaining({ name: 'Paris', _labels: ['Place'] })])
    expect(typeof near[0]._id).toBe('string')
  })

  it('serialises collections of hydrated entities', async () => {
    await backend.neode.save(Place.build({ name: 'London' }))
    await backend.neode.save(Place.build({ name: 'Paris' }))

    const results = await backend.neode.get<Place>(Place, {})
    const collection = new Collection(results)

    expect(collection.length).toBe(2)

    const output = await collection.toJson()

    expect(output).toHaveLength(2)

    const names = output.map((place) => (place as Record<string, unknown>).name)

    expect(names).toEqual(expect.arrayContaining(['London', 'Paris']))

    // Serialised collections are JSON friendly end to end
    expect(JSON.parse(JSON.stringify(output))).toHaveLength(2)
  })
})

// ---- NTS-564: toJson relationship serialisation control --------------------

describe('toJson relationship serialisation options (NTS-564)', () => {
  let backend: TestBackend

  // London -nearby-> Paris -nearby-> Lyon; London -views-> Eiffel
  async function seedChain(): Promise<Landmark> {
    for (const name of ['London', 'Paris', 'Lyon', 'Eiffel']) {
      await backend.neode.save(Landmark.build({ name }))
    }

    await backend.connection.run(
      'MATCH (a:Landmark {name: $from}), (b:Landmark {name: $to}) CREATE (a)-[:NEARBY]->(b)',
      { from: 'London', to: 'Paris' },
    )
    await backend.connection.run(
      'MATCH (a:Landmark {name: $from}), (b:Landmark {name: $to}) CREATE (a)-[:NEARBY]->(b)',
      { from: 'Paris', to: 'Lyon' },
    )
    await backend.connection.run(
      'MATCH (a:Landmark {name: $from}), (b:Landmark {name: $to}) CREATE (a)-[:VIEW_OF]->(b)',
      { from: 'London', to: 'Eiffel' },
    )

    const london = await backend.neode.getFirst<Landmark>(Landmark, { name: 'London' })

    expect(london).toBeDefined()

    return london!
  }

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    clearFilterParams()
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('serialises every loaded relationship, unlimited depth, with no options (unchanged)', async () => {
    const london = await seedChain()
    await london.load({ nearby: { nearby: true }, views: true })

    const output = toJson(london)

    expect(output.nearby).toEqual([
      expect.objectContaining({
        name: 'Paris',
        nearby: [expect.objectContaining({ name: 'Lyon' })],
      }),
    ])
    expect(output.views).toEqual([expect.objectContaining({ name: 'Eiffel' })])
  })

  it('include serialises only the named relationships (NTS-564)', async () => {
    const london = await seedChain()
    await london.load({ nearby: { nearby: true }, views: true })

    const output = toJson(london, { relationships: { include: ['nearby'] } })

    expect(output.nearby).toEqual([
      expect.objectContaining({
        name: 'Paris',
        nearby: [expect.objectContaining({ name: 'Lyon' })],
      }),
    ])
    expect(output).not.toHaveProperty('views')
  })

  it('include skips a declared but unloaded relationship without throwing', async () => {
    const london = await seedChain()
    await london.load({ nearby: true })

    const output = toJson(london, { relationships: { include: ['nearby', 'views'] } })

    expect(output.nearby).toEqual([expect.objectContaining({ name: 'Paris' })])
    expect(output).not.toHaveProperty('views')
  })

  it('exclude drops the named relationship (NTS-564)', async () => {
    const london = await seedChain()
    await london.load({ nearby: { nearby: true }, views: true })

    const output = toJson(london, { relationships: { exclude: ['views'] } })

    expect(output.nearby).toEqual([
      expect.objectContaining({
        name: 'Paris',
        nearby: [expect.objectContaining({ name: 'Lyon' })],
      }),
    ])
    expect(output).not.toHaveProperty('views')
  })

  it('depth truncates nested relationship serialisation (NTS-564)', async () => {
    const london = await seedChain()
    await london.load({ nearby: { nearby: true }, views: true })

    const oneLevel = toJson(london, { relationships: { depth: 1 } })

    expect(oneLevel.nearby).toEqual([expect.objectContaining({ name: 'Paris' })])
    // Paris serialises its properties, not its own relationships
    const paris = oneLevel.nearby as Record<string, unknown>[]
    expect(paris[0]).not.toHaveProperty('nearby')
    expect(oneLevel.views).toEqual([expect.objectContaining({ name: 'Eiffel' })])

    const noRelationships = toJson(london, { relationships: { depth: 0 } })

    expect(noRelationships).not.toHaveProperty('nearby')
    expect(noRelationships).not.toHaveProperty('views')
    expect(noRelationships.name).toBe('London')
  })

  it('filtered-out relation targets serialise as the loaded-and-empty shape (NTS-162/564)', async () => {
    await backend.neode.save(GuardedSite.build({ name: 'Fort' }))
    await backend.neode.save(Gate.build({ name: 'North Gate', tenant: 'acme' }))
    await backend.connection.run(
      'MATCH (s:GuardedSite {name: $site}), (g:Gate {name: $gate}) CREATE (s)-[:GATE]->(g)',
      { site: 'Fort', gate: 'North Gate' },
    )

    setFilterParams('gate_tenant', 'nobody-matches')

    const site = await backend.neode.getFirst<GuardedSite>(GuardedSite, { name: 'Fort' })

    expect(site).toBeDefined()
    expect(site!.gates).toEqual([])

    // The loaded-and-empty shape serialises as [], never throws — with
    // and without options
    expect(toJson(site!).gates).toEqual([])
    expect(toJson(site!, { relationships: { include: ['gates'] } }).gates).toEqual([])
    expect(toJson(site!, { relationships: { exclude: ['gates'] } })).not.toHaveProperty('gates')
  })

  it('unknown include / exclude keys throw the schema error naming valid relationships', async () => {
    const london = await seedChain()

    expect(() => toJson(london, { relationships: { include: ['nearbi'] } })).toThrow(
      expect.objectContaining({
        name: 'NeodeError',
        message: expect.stringContaining(
          'Relationship "nearbi" is not defined on model "Landmark" — did you mean "nearby"?',
        ),
      }),
    )
    expect(() => toJson(london, { relationships: { exclude: ['view'] } })).toThrow(
      expect.objectContaining({
        name: 'NeodeError',
        message: expect.stringContaining('did you mean "views"?'),
      }),
    )
    expect(() => toJson(london, { relationships: { depth: 1.5 } })).toThrow(NeodeError)
    expect(() => toJson(london, { relationships: { depth: -1 } })).toThrow(NeodeError)
  })
})
