import {
  NodeEntity,
  Uuid,
  String,
  InternalId,
  Date,
  DateTime,
  Duration,
  Point,
  OneToMany,
} from '../../src/decorators'
import { Direction } from '../../src/query'
import { Collection } from '../../src/collection'
import { toJson } from '../../src/serialise'
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
