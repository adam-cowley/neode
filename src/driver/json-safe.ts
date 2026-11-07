import {
  isDate,
  isDateTime,
  isDuration,
  isInt,
  isLocalDateTime,
  isLocalTime,
  isNode,
  isPath,
  isPoint,
  isRelationship,
  isTime,
} from 'neo4j-driver'
import { isRecord } from '../services/type-guards.js'
import type { QueryRecord } from './types.js'

/**
JSON-safe serialisation for raw query values: converts the driver class
instances that survive value normalisation (Integer, temporal types, Point,
Path) and bigints into structures that survive JSON.stringify, recursing
through arrays and plain objects. Everything else passes through unchanged.
*/
export function jsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  // BigInt is not JSON-stringifiable; stringify is lossless for ids
  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (isInt(value)) {
    return value.toNumber()
  }

  if (
    isDate(value) ||
    isDateTime(value) ||
    isTime(value) ||
    isLocalTime(value) ||
    isLocalDateTime(value) ||
    isDuration(value)
  ) {
    return value.toString()
  }

  if (isPoint(value)) {
    const { srid, x, y, z } = value

    return z === undefined ? { srid, x, y } : { srid, x, y, z }
  }

  if (isNode(value)) {
    return {
      elementId: value.elementId,
      labels: value.labels,
      properties: jsonSafe(value.properties),
    }
  }

  if (isRelationship(value)) {
    return {
      elementId: value.elementId,
      type: value.type,
      startElementId: value.startNodeElementId,
      endElementId: value.endNodeElementId,
      properties: jsonSafe(value.properties),
    }
  }

  if (isPath(value)) {
    const path = value

    return {
      start: jsonSafe(path.start),
      end: jsonSafe(path.end),
      length: path.length,
      segments: path.segments.map((segment) => ({
        start: jsonSafe(segment.start),
        relationship: jsonSafe(segment.relationship),
        end: jsonSafe(segment.end),
      })),
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => jsonSafe(item))
  }

  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]))
  }

  return value
}

/**
A QueryRecord whose values are JSON-safe (the rows of `Neode#cypher`).
*/
export function jsonSafeRecord(record: QueryRecord): QueryRecord {
  return {
    get: (key: string) => jsonSafe(record.get(key)),
    has: (key: string) => record.has(key),
    keys: record.keys,
  }
}
