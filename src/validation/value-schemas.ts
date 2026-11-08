import { z } from 'zod'
import {
  Date as DriverDate,
  DateTime as DriverDateTime,
  isDate,
  isDateTime,
  isDuration,
  isInt,
  isLocalDateTime,
  isLocalTime,
  isPoint,
  isTime,
  LocalDateTime as DriverLocalDateTime,
  LocalTime as DriverLocalTime,
  Time as DriverTime,
} from 'neo4j-driver'

import { isRecord } from '../services/type-guards.js'

/**
Zod schemas for the property value types that are not plain JSON.

Each schema accepts BOTH plain JavaScript input (what a user writes in
code — validation runs on input values before convertPropertyValue) and
the already-converted Neo4j driver instances (what comes back from the
database or from a second pass after conversion).
*/

/**
Spatial Reference System Identifiers used by Neo4j for point properties
*/
const SRID = {
  CARTESIAN_2D: 7203,
  CARTESIAN_3D: 9157,
  WGS_84_2D: 4326,
  WGS_84_3D: 4979,
} as const

const POINT_SRIDS: number[] = Object.values(SRID)

// Scalar bases for the rule table
export const stringSchema = z.string()
export const booleanSchema = z.boolean()
export const floatSchema = z.number()

/**
NUMBER properties accept the same values as FLOAT properties
*/
export const numberSchema = z.number()

export const uuidSchema = z.uuid()
export const anySchema = z.any()

/**
INTEGER accepts native numbers and Neo4j Integer instances — the port of
neode's `neoInteger` Joi extension (Joi.number().integer() alternatives
Joi.object().type(neo4j.types.Integer)).
*/
export const integerSchema: z.ZodType = z.union([
  z.number().int(),
  z.custom((value) => isInt(value)),
])

/**
The string form of an engine value object: the driver's temporal value
classes and the embedded engine's Cypher value classes override toString
to their parseable Cypher form.
*/
export function isStringFormed(value: unknown): value is { toString(): string } {
  return isRecord(value) && typeof value.toString === 'function'
}

/**
Every named key carries a finite number (the client-decoded temporal shape).
*/
function hasNumberComponents(value: unknown, keys: readonly string[]): boolean {
  return (
    isRecord(value) &&
    keys.every((key) => {
      const component = value[key]

      return typeof component === 'number' && Number.isFinite(component)
    })
  )
}

/**
The closed set of temporal-ish keys — a decoded value carrying one
outside its kind's components is a different kind (a DateTime where a
Date is required, an offset where none is allowed).
*/
const KNOWN_TEMPORAL_KEYS = new Set([
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'nanosecond',
  'timeZoneOffsetSeconds',
  'timeZoneSuffixSeconds',
])

function hasOnlyOwnTemporalComponents(value: unknown, keys: readonly string[]): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).some((key) => KNOWN_TEMPORAL_KEYS.has(key) && !keys.includes(key))
  )
}

/**
The component keys each temporal kind carries once decoded.
*/
const TEMPORAL_COMPONENTS = {
  date: ['year', 'month', 'day'],
  time: ['hour', 'minute', 'second', 'nanosecond'],
  datetime: ['year', 'month', 'day', 'hour', 'minute', 'second', 'nanosecond'],
} as const

/**
A temporal value is valid when it is the driver instance itself, a
JavaScript Date, epoch milliseconds, a string the driver can parse
exactly (the same contract as convertPropertyValue, so anything that
validates here will convert cleanly afterwards), or a decoded temporal
object from another backend carrying numeric components (the Relate
client's CypherDate/CypherDateTime classes — the hydration shape on the
embedded engine, NTS-508).
*/
function temporalSchema(
  isInstance: (value: unknown) => boolean,
  fromString: (value: string) => unknown,
  label: string,
  components: readonly string[],
): z.ZodType {
  return z.custom(
    (value) => {
      if (isInstance(value) || value instanceof Date) {
        return true
      }

      if (typeof value === 'number') {
        return Number.isFinite(value) && !Number.isNaN(new Date(value).getTime())
      }

      if (typeof value === 'string') {
        try {
          fromString(value)

          return true
        } catch {
          return false
        }
      }

      // Structural check for other engine value classes: accepted when their
      // string form parses like the driver's own values
      if (isStringFormed(value)) {
        try {
          fromString(value.toString())

          return true
        } catch {
          // Fall through to the component check
        }
      }

      // Decoded temporal objects from other backends: numeric components,
      // and none of a different kind
      return (
        hasNumberComponents(value, components) && !hasOnlyOwnTemporalComponents(value, components)
      )
    },
    {
      message: `Expected a ${label} value (parseable string, Date, epoch number or driver instance)`,
    },
  )
}

export const dateSchema: z.ZodType = temporalSchema(
  (value) => isDate(value),
  (value) => DriverDate.fromString(value),
  'Neo4j Date',
  TEMPORAL_COMPONENTS.date,
)

export const timeSchema: z.ZodType = temporalSchema(
  (value) => isTime(value),
  (value) => DriverTime.fromString(value),
  'Neo4j Time',
  TEMPORAL_COMPONENTS.time,
)

export const datetimeSchema: z.ZodType = temporalSchema(
  (value) => isDateTime(value),
  (value) => DriverDateTime.fromString(value),
  'Neo4j DateTime',
  TEMPORAL_COMPONENTS.datetime,
)

export const localtimeSchema: z.ZodType = temporalSchema(
  (value) => isLocalTime(value),
  (value) => DriverLocalTime.fromString(value),
  'Neo4j LocalTime',
  TEMPORAL_COMPONENTS.time,
)

export const localdatetimeSchema: z.ZodType = temporalSchema(
  (value) => isLocalDateTime(value),
  (value) => DriverLocalDateTime.fromString(value),
  'Neo4j LocalDateTime',
  TEMPORAL_COMPONENTS.datetime,
)

function isCoordinate(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
A point is valid when it is a driver Point instance with a Neo4j SRID, or
a plain { x, y[, z] } cartesian object or { latitude, longitude[, height] }
geographic object. An explicit `srid` must agree with the coordinate shape
(7203/9157 cartesian, 4326/4979 WGS 84) — neode delegated this to the
driver's Point type check, we validate the SRID consistency up front.
*/
export const pointSchema: z.ZodType = z.custom(
  (value) => {
    if (isPoint(value)) {
      // driver v6 types Point.srid as Integer but stores a plain number
      const srid: unknown = value.srid

      return typeof srid === 'number' && POINT_SRIDS.includes(srid)
    }

    if (!isRecord(value)) {
      return false
    }

    const { x, y, z, latitude, longitude, height, srid } = value

    // Cartesian coordinates
    if (x !== undefined || y !== undefined || z !== undefined) {
      if (latitude !== undefined || longitude !== undefined || height !== undefined) {
        return false
      }

      if (!isCoordinate(x) || !isCoordinate(y) || (z !== undefined && !isCoordinate(z))) {
        return false
      }

      if (srid === undefined) {
        return true
      }

      return srid === (z === undefined ? SRID.CARTESIAN_2D : SRID.CARTESIAN_3D)
    }

    // WGS 84 (geographic) coordinates
    if (latitude !== undefined || longitude !== undefined || height !== undefined) {
      if (!isCoordinate(latitude) || !isCoordinate(longitude)) {
        return false
      }

      if (height !== undefined && !isCoordinate(height)) {
        return false
      }

      if (srid === undefined) {
        return true
      }

      return srid === (height === undefined ? SRID.WGS_84_2D : SRID.WGS_84_3D)
    }

    return false
  },
  {
    message:
      'Expected a Neo4j point ({ x, y[, z] } or { latitude, longitude[, height] } with a consistent SRID, or a driver Point)',
  },
)

/**
A duration is valid when it is a driver Duration instance or a plain
object of non-negative integer components (neode never validated
durations — they were stored as strings).
*/
export const durationSchema: z.ZodType = z.custom(
  (value) => {
    if (isDuration(value)) {
      return true
    }

    if (!isRecord(value)) {
      return false
    }

    const { months = 0, days = 0, seconds = 0, nanoseconds = 0 } = value

    return [months, days, seconds, nanoseconds].every(
      (component) =>
        typeof component === 'number' && Number.isSafeInteger(component) && component >= 0,
    )
  },
  {
    message:
      'Expected a Neo4j duration ({ months, days, seconds, nanoseconds } or a driver Duration)',
  },
)
