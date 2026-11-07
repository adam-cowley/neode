// support/backend first: it initialises neode.service, breaking the
// utils <-> neode.service circular init that would otherwise surface
// when this file's service imports are evaluated first.
import { openBackend, TestBackend } from './support/backend'
import neo4j from 'neo4j-driver'
import { NodeEntity, Uuid, String, InternalId, Point } from '../../src/decorators'
import { getModel } from '../../src/meta'
import { WithinDistanceService } from '../../src/services/query/within-distance.service'
import { OrderSpec } from '../../src/services/query/get.service'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Place {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String()
  name: string

  @Point()
  location: { x: number; y: number }
}

// ---------------------------------------------------------------------------

describe('WithinDistanceService', () => {
  let backend: TestBackend
  let service: WithinDistanceService

  beforeAll(async () => {
    backend = await openBackend()
    service = new WithinDistanceService(backend.connection)
  })

  beforeEach(async () => {
    await backend.clearGraph()

    // Origin (distance 0), Near (distance 5), Far (distance 50)
    await backend.connection.run(
      "CREATE (:Place {name: 'Origin', location: point({x: 0, y: 0})}) " +
        "CREATE (:Place {name: 'Near', location: point({x: 3, y: 4})}) " +
        "CREATE (:Place {name: 'Far', location: point({x: 30, y: 40})})",
    )
  })

  afterAll(async () => {
    await backend.clearGraph()
    await backend.close()
  })

  // The backend supports points unless the probe in support/backend.ts failed
  const requiresPoints = (): boolean => backend.capabilities.points

  const query = async (
    point: unknown,
    distance: number,
    params: Record<string, unknown> = {},
    order?: OrderSpec,
    limit?: number,
    skip?: number,
  ): Promise<string[]> => {
    const schema = getModel(Place)

    const results = await service.withinDistance<Place>(
      Place,
      schema,
      'location',
      point,
      distance,
      params,
      order,
      limit,
      skip,
    )

    return results.map((place) => place.name)
  }

  it('returns only nodes within the distance of a plain {x, y} point', async () => {
    if (!requiresPoints()) {
      return
    }

    const names = await query({ x: 0, y: 0 }, 10)

    expect(names.sort()).toEqual(['Near', 'Origin'])
  })

  it('accepts a driver Point as the origin', async () => {
    if (!requiresPoints()) {
      return
    }

    const names = await query(new neo4j.Point(7203, 0, 0), 10)

    expect(names.sort()).toEqual(['Near', 'Origin'])
  })

  it('combines the distance filter with property wheres', async () => {
    if (!requiresPoints()) {
      return
    }

    const names = await query({ x: 0, y: 0 }, 10, { name: 'Near' })

    expect(names).toEqual(['Near'])
  })

  it('orders results by a property when an order is given', async () => {
    if (!requiresPoints()) {
      return
    }

    const names = await query({ x: 0, y: 0 }, 100, {}, { field: 'name', order: 'DESC' })

    expect(names).toEqual(['Origin', 'Near', 'Far'])
  })

  it('orders results by distance when order is "distance"', async () => {
    if (!requiresPoints()) {
      return
    }

    const names = await query({ x: 0, y: 0 }, 100, {}, 'distance')

    expect(names).toEqual(['Origin', 'Near', 'Far'])
  })

  it('rejects a location property that is not on the schema', async () => {
    await expect(
      query({ x: 0, y: 0 }, 10), // sanity: the happy path works
    ).resolves.toHaveLength(2)

    const schema = getModel(Place)

    await expect(
      service.withinDistance(Place, schema, 'not_a_property', { x: 0, y: 0 }, 10),
    ).rejects.toThrow(TypeError)
  })

  it('applies skip and limit on top of the distance filter', async () => {
    if (!requiresPoints()) {
      return
    }

    const names = await query({ x: 0, y: 0 }, 100, {}, 'distance', 1, 1)

    expect(names).toEqual(['Near'])
  })
})
