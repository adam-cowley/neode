import type { Newable } from '../../meta/newable.js'
import { Builder } from '../../query/index.js'
import { THIS_NODE } from '../../constants.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import type { PropertySchema } from '../../meta/property-schema.js'
import { convertPropertyValue } from '../../utilities.js'
import { isPoint } from 'neo4j-driver'
import { QueryService } from './query.service.js'
import { applyOrder, type OrderSpec } from './get.service.js'

// SRIDs of the point types Neo4j supports
const SRID = {
  CARTESIAN_2D: 7203,
  CARTESIAN_3D: 9157,
  WGS_84_2D: 4326,
  WGS_84_3D: 4979,
} as const

const requireFiniteNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Cannot query withinDistance: ${label} must be a finite number`)
  }

  return value
}

/**
Render the origin point as an inline `point({...})` expression.

The point cannot be passed as a query parameter: backends reject driver
Point parameters (and a plain {x, y} map would be read as the wrong type),
so - like neode's FindWithinDistance - the expression is inlined after the
coordinates have been validated as numbers.
*/
function toCypherPoint(point: unknown, property: PropertySchema): string {
  const converted = convertPropertyValue(point, property)

  if (!isPoint(converted)) {
    throw new TypeError(
      'Cannot query withinDistance: expected a point ({ x, y[, z] }, { latitude, longitude[, height] } or a driver Point)',
    )
  }

  const srid = Number(converted.srid)
  const x = requireFiniteNumber(converted.x, 'point x')
  const y = requireFiniteNumber(converted.y, 'point y')

  switch (srid) {
    case SRID.CARTESIAN_3D: {
      const z = requireFiniteNumber(converted.z, 'point z')

      return `point({ x: ${String(x)}, y: ${String(y)}, z: ${String(z)} })`
    }
    case SRID.WGS_84_2D: {
      // Driver Points store longitude as x, latitude as y
      return `point({ longitude: ${String(x)}, latitude: ${String(y)} })`
    }
    case SRID.WGS_84_3D: {
      const height = requireFiniteNumber(converted.z, 'point height')

      return `point({ longitude: ${String(x)}, latitude: ${String(y)}, height: ${String(height)} })`
    }
    default: {
      return `point({ x: ${String(x)}, y: ${String(y)} })`
    }
  }
}

export class WithinDistanceService extends QueryService {
  async withinDistance<T>(
    constructor: Newable,
    schema: EntitySchema,
    locationProperty: string,
    point: unknown,
    distance: number,
    parameters: Record<string, unknown> = {},
    order?: OrderSpec,
    limit?: number,
    skip?: number,
  ): Promise<T[]> {
    const builder = new Builder()

    builder.match(THIS_NODE, schema.getLabels())

    for (const property of schema.getProperties()) {
      const key = property.getKey()

      if (Object.hasOwn(parameters, key)) {
        builder.where(`${THIS_NODE}.${key}`, parameters[key])
      }
    }

    const location = schema
      .getProperties()
      .find((property) => property.getKey() === locationProperty)

    if (!location) {
      throw new TypeError(
        `Cannot query withinDistance: property "${locationProperty}" is not defined on the schema`,
      )
    }

    requireFiniteNumber(distance, 'distance')

    const origin = toCypherPoint(point, location)

    builder.whereRaw(
      `point.distance(${THIS_NODE}.${locationProperty}, ${origin}) <= ${String(distance)}`,
    )

    // Order by distance from the origin when asked for, otherwise by property
    if (order === 'distance') {
      builder.orderBy(`point.distance(${THIS_NODE}.${locationProperty}, ${origin})`)
    } else {
      applyOrder(builder, order)
    }

    return this.return<T>(constructor, schema, builder, skip, limit)
  }
}
