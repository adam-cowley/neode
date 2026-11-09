import {
  isDate,
  isDateTime,
  isDuration,
  isInt,
  isLocalDateTime,
  isLocalTime,
  isPoint,
  isTime,
} from 'neo4j-driver'
import { NeodeError } from './errors/index.js'
import { getModel } from './meta/index.js'
import type { PropertySchema } from './meta/property-schema.js'
import { PropertyType } from './meta/property-schema.js'
import { isRecord } from './services/type-guards.js'

/**
Property types that carry graph structure rather than user data: they are
skipped by toJson() (internal ids surface through the `_id` field instead).
*/
const NON_OUTPUT_TYPES = new Set<PropertyType>([
  PropertyType.INTERNAL_ID,
  PropertyType.ALL_PROPERTIES,
  PropertyType.NODE,
  PropertyType.RELATIONSHIP,
  PropertyType.ONE_TO_ONE,
  PropertyType.ONE_TO_MANY,
  PropertyType.START_NODE,
  PropertyType.END_NODE,
  PropertyType.OTHER_NODE,
])

const pad = (value: number, length = 2): string => String(value).padStart(length, '0')

/**
A numeric field of a plain temporal object (the embedded Relate engine's
hydrated shape): the first key holding a number, else 0.
*/
function numberAt(value: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const field: unknown = value[key]

    if (typeof field === 'number') {
      return field
    }
  }

  return 0
}

function hasKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => Reflect.has(value, key))
}

function dateToString(value: Record<string, unknown>): string {
  return `${pad(numberAt(value, 'year'), 4)}-${pad(numberAt(value, 'month'))}-${pad(numberAt(value, 'day'))}`
}

function offsetToString(offsetSeconds: unknown): string {
  if (typeof offsetSeconds !== 'number' || Number.isNaN(offsetSeconds)) {
    return ''
  }

  if (offsetSeconds === 0) {
    return 'Z'
  }

  const sign = offsetSeconds < 0 ? '-' : '+'
  const abs = Math.abs(offsetSeconds)

  return `${sign}${pad(Math.floor(abs / 3600))}:${pad(Math.floor((abs % 3600) / 60))}`
}

function timeToString(value: Record<string, unknown>): string {
  const base = `${pad(numberAt(value, 'hour'))}:${pad(numberAt(value, 'minute'))}:${pad(numberAt(value, 'second'))}`
  const nanoseconds = numberAt(value, 'nanosecond')

  return nanoseconds === 0 ? base : `${base}.${pad(nanoseconds, 9)}`
}

function durationToString(value: Record<string, unknown>): string {
  const seconds = numberAt(value, 'seconds')
  const nanos = numberAt(value, 'nanos', 'nanoseconds')
  const fraction = nanos === 0 ? '' : `.${pad(nanos, 9)}`

  return `P${String(numberAt(value, 'months'))}M${String(numberAt(value, 'days'))}DT${String(seconds)}${fraction}S`
}

function pointToJson(value: Record<string, unknown>): Record<string, unknown> {
  const raw = value['srid']
  // The driver hands the srid back as an Integer instance, not a number
  let srid = Number(raw)

  if (typeof raw === 'number') {
    srid = raw
  } else if (isInt(raw)) {
    srid = raw.toNumber()
  }

  const { x, y, z } = value

  return z === undefined || z === null ? { srid, x, y } : { srid, x, y, z }
}

/**
Convert a Neo4j driver instance into its JSON friendly shape.
Temporal types share an ISO string via toString(); points become plain
coordinate objects. Returns undefined for non-driver values.
*/
function driverValueToJson(value: unknown): unknown {
  if (isInt(value)) {
    return value.toNumber()
  }

  // Durations are formatted canonically (P0M1DT0S) rather than trusted to
  // toString(): the driver's own spelling omits zero components (P1DT)
  if (isDuration(value)) {
    return durationToString({
      months: Number(value.months),
      days: Number(value.days),
      seconds: Number(value.seconds),
      nanoseconds: Number(value.nanoseconds),
    })
  }

  if (
    isDate(value) ||
    isDateTime(value) ||
    isTime(value) ||
    isLocalDateTime(value) ||
    isLocalTime(value)
  ) {
    return value.toString()
  }

  if (isPoint(value) && isRecord(value)) {
    return pointToJson(value)
  }

  return undefined
}

/**
Convert a plain object (as hydrated by the embedded Relate engine) into
its JSON friendly shape, keyed by the property's declared type. Returns
undefined when the value doesn't match the expected shape.
*/
function plainObjectToJson(value: Record<string, unknown>, type: PropertyType): unknown {
  switch (type) {
    case PropertyType.DATE: {
      if (hasKeys(value, ['year', 'month', 'day'])) {
        return dateToString(value)
      }
      break
    }

    case PropertyType.TIME: {
      if (hasKeys(value, ['hour', 'minute', 'second'])) {
        return timeToString(value) + offsetToString(value['offsetSeconds'])
      }
      break
    }

    case PropertyType.LOCALTIME: {
      if (hasKeys(value, ['hour', 'minute', 'second'])) {
        return timeToString(value)
      }
      break
    }

    case PropertyType.DATETIME: {
      if (hasKeys(value, ['year', 'month', 'day', 'hour', 'minute', 'second'])) {
        const zone = typeof value['zone'] === 'string' ? `[${value['zone']}]` : ''

        return (
          dateToString(value) +
          'T' +
          timeToString(value) +
          offsetToString(value['offsetSeconds']) +
          zone
        )
      }
      break
    }

    case PropertyType.LOCALDATETIME: {
      if (hasKeys(value, ['year', 'month', 'day', 'hour', 'minute', 'second'])) {
        return dateToString(value) + 'T' + timeToString(value)
      }
      break
    }

    case PropertyType.DURATION: {
      if (hasKeys(value, ['months', 'days', 'seconds'])) {
        return durationToString(value)
      }
      break
    }

    case PropertyType.POINT: {
      if (hasKeys(value, ['srid', 'x', 'y'])) {
        return pointToJson(value)
      }
      break
    }

    case PropertyType.ANY:
    case PropertyType.INTERNAL_ID:
    case PropertyType.ALL_PROPERTIES:
    case PropertyType.UUID:
    case PropertyType.STRING:
    case PropertyType.INTEGER:
    case PropertyType.FLOAT:
    case PropertyType.NUMBER:
    case PropertyType.BOOLEAN:
    case PropertyType.ONE_TO_ONE:
    case PropertyType.ONE_TO_MANY:
    case PropertyType.RELATED_ONE:
    case PropertyType.RELATED_MANY:
    case PropertyType.RELATIONSHIP_COUNT:
    case PropertyType.RELATIONSHIP_EXISTS:
    case PropertyType.LABEL_PRESENT:
    case PropertyType.COMPUTED:
    case PropertyType.EXPRESSION:
    case PropertyType.START_NODE:
    case PropertyType.END_NODE:
    case PropertyType.OTHER_NODE:
    case PropertyType.NODE:
    case PropertyType.RELATIONSHIP: {
      break
    }
  }

  return undefined
}

function isEntity(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    getModel((value as { constructor?: unknown }).constructor) !== undefined
  )
}

function toOutputValue(value: unknown, property: PropertySchema): unknown {
  // Nested entities (eagerly loaded relationships, arrays of entities)
  if (Array.isArray(value)) {
    return value.map((item) => toOutputValue(item, property))
  }

  if (isEntity(value)) {
    return toJson(value)
  }

  return valueToJson(value, property)
}

/**
Convert a single property value into its JSON friendly shape.
*/
export function valueToJson(value: unknown, property: PropertySchema): unknown {
  if (value === null || value === undefined) {
    return value
  }

  // Neo4j driver instances (neo4j backend): ISO strings / plain coordinates
  const driver = driverValueToJson(value)

  if (driver !== undefined) {
    return driver
  }

  if (isRecord(value)) {
    const plain = plainObjectToJson(value, property.getType())

    if (plain !== undefined) {
      return plain
    }
  }

  return value
}

/**
Convert an entity into a JSON friendly object: plain properties (hidden and
structural properties skipped), `_id` (elementId when the model carries an
internal id property) and `_labels` (the schema's labels). Eagerly loaded
relationships are serialised recursively.
*/
export function toJson(entity: unknown): Record<string, unknown> {
  const instance = isRecord(entity) ? entity : undefined
  const schema = instance === undefined ? undefined : getModel(instance.constructor)

  if (schema === undefined || instance === undefined) {
    const name = instance?.constructor.name ?? String(entity)

    throw new NeodeError(
      `Cannot serialise "${name}": no model is registered for it — ` +
        'register the class with @NodeEntity or defineModel() first',
    )
  }

  const properties = schema.getProperties()
  const internalId = properties.find((property) => property.getType() === PropertyType.INTERNAL_ID)

  const output: Record<string, unknown> = {
    _id: internalId === undefined ? null : (instance[internalId.getKey()] ?? null),
    _labels: schema.getLabels(),
  }

  for (const property of properties) {
    const key = property.getKey()

    if (property.isHidden() || NON_OUTPUT_TYPES.has(property.getType())) {
      continue
    }

    const value = instance[key]

    // Un-set properties are omitted (parity with neode's properties map)
    if (value === undefined) {
      continue
    }

    output[key] = toOutputValue(value, property)
  }

  // Eagerly loaded relationships: single entities or arrays of entities
  for (const relationship of schema.getRelationships()) {
    const key = relationship.getKey()

    if (!Object.hasOwn(instance, key)) {
      continue
    }

    const value = instance[key]

    if (value === undefined || value === null) {
      continue
    }

    output[key] = Array.isArray(value) ? value.map((item) => toJson(item)) : toJson(value)
  }

  return output
}
