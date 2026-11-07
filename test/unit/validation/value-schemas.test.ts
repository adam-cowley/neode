import neo4j from 'neo4j-driver'

import {
  anySchema,
  booleanSchema,
  dateSchema,
  datetimeSchema,
  durationSchema,
  floatSchema,
  integerSchema,
  localdatetimeSchema,
  localtimeSchema,
  numberSchema,
  pointSchema,
  stringSchema,
  timeSchema,
  uuidSchema,
} from '../../../src/validation/value-schemas'

describe('value-schemas', () => {
  describe('scalar bases', () => {
    it('should accept strings and reject other types', () => {
      expect(stringSchema.safeParse('foo').success).toBe(true)
      expect(stringSchema.safeParse(123).success).toBe(false)
    })

    it('should accept booleans only', () => {
      expect(booleanSchema.safeParse(true).success).toBe(true)
      expect(booleanSchema.safeParse(false).success).toBe(true)
      expect(booleanSchema.safeParse('true').success).toBe(false)
      expect(booleanSchema.safeParse(1).success).toBe(false)
    })

    it('should reject 3.5 as an integer', () => {
      expect(integerSchema.safeParse(3.5).success).toBe(false)
    })

    it('should accept integers, floats and neo4j Integer instances', () => {
      expect(integerSchema.safeParse(42).success).toBe(true)
      expect(integerSchema.safeParse(neo4j.int(7)).success).toBe(true)
      expect(integerSchema.safeParse('42').success).toBe(false)

      expect(floatSchema.safeParse(1.5).success).toBe(true)
      expect(floatSchema.safeParse('1.5').success).toBe(false)

      expect(numberSchema.safeParse(1.5).success).toBe(true)
      expect(numberSchema.safeParse('1.5').success).toBe(false)
    })

    it('should validate UUIDs', () => {
      expect(uuidSchema.safeParse('3f8a5c92-4d1e-4a6b-9c2f-7e8d1a2b3c4d').success).toBe(true)
      expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false)
    })

    it('should accept anything', () => {
      expect(anySchema.safeParse({ nested: { deep: [1, 2, 3] } }).success).toBe(true)
    })
  })

  describe('temporal', () => {
    it('should accept ISO date strings for date', () => {
      expect(dateSchema.safeParse('2020-06-15').success).toBe(true)
    })

    it('should reject datetime strings for date', () => {
      expect(dateSchema.safeParse('2020-06-15T10:30:00Z').success).toBe(false)
    })

    it('should accept Date objects and epoch milliseconds for date', () => {
      expect(dateSchema.safeParse(new Date()).success).toBe(true)
      expect(dateSchema.safeParse(1590000000000).success).toBe(true)
      expect(dateSchema.safeParse(Number.NaN).success).toBe(false)
    })

    it('should accept driver Date instances and reject other driver temporals', () => {
      expect(dateSchema.safeParse(new neo4j.Date(2020, 5, 15)).success).toBe(true)
      expect(dateSchema.safeParse(neo4j.DateTime.fromStandardDate(new Date())).success).toBe(false)
    })

    it('should accept timezone-aware datetime strings only', () => {
      expect(datetimeSchema.safeParse('2020-06-15T10:30:00Z').success).toBe(true)
      expect(datetimeSchema.safeParse('2020-06-15T10:30:00+02:00').success).toBe(true)
      expect(datetimeSchema.safeParse('2020-06-15T10:30:00').success).toBe(false)
    })

    it('should accept time strings and driver Time instances', () => {
      expect(timeSchema.safeParse('10:30:00Z').success).toBe(true)
      expect(timeSchema.safeParse('10:30:00.123456789Z').success).toBe(true)
      expect(timeSchema.safeParse('10:30:00').success).toBe(false)
      expect(timeSchema.safeParse('2020-06-15').success).toBe(false)
      expect(timeSchema.safeParse(neo4j.Time.fromString('10:30:00Z')).success).toBe(true)
      expect(timeSchema.safeParse(new neo4j.Date(2020, 5, 15)).success).toBe(false)
    })

    it('should accept local variants without timezone', () => {
      expect(localtimeSchema.safeParse('10:30:00').success).toBe(true)
      expect(localtimeSchema.safeParse(new neo4j.LocalTime(10, 30, 0, 0)).success).toBe(true)
      expect(localdatetimeSchema.safeParse('2020-06-15T10:30:00').success).toBe(true)
      expect(localdatetimeSchema.safeParse('2020-06-15T10:30:00Z').success).toBe(false)
      expect(
        localdatetimeSchema.safeParse(new neo4j.LocalDateTime(2020, 5, 15, 10, 30, 0, 0)).success,
      ).toBe(true)
    })

    it('should reject garbage strings', () => {
      expect(dateSchema.safeParse('nope').success).toBe(false)
      expect(timeSchema.safeParse('nope').success).toBe(false)
      expect(datetimeSchema.safeParse('nope').success).toBe(false)
      expect(localtimeSchema.safeParse('nope').success).toBe(false)
      expect(localdatetimeSchema.safeParse('nope').success).toBe(false)
    })

    it('should accept engine value classes with a parseable string form', () => {
      class CypherDate {
        toString(): string {
          return '2020-06-15'
        }
      }

      expect(dateSchema.safeParse(new CypherDate()).success).toBe(true)
      expect(dateSchema.safeParse({ not: 'a date' }).success).toBe(false)
    })
  })

  describe('point', () => {
    it('should accept cartesian shapes', () => {
      expect(pointSchema.safeParse({ x: 1, y: 2 }).success).toBe(true)
      expect(pointSchema.safeParse({ x: 1, y: 2, z: 3 }).success).toBe(true)
      expect(pointSchema.safeParse({ x: 1, y: 2, srid: 7203 }).success).toBe(true)
      expect(pointSchema.safeParse({ x: 1, y: 2, z: 3, srid: 9157 }).success).toBe(true)
    })

    it('should accept wgs84 shapes', () => {
      expect(pointSchema.safeParse({ latitude: 51.5, longitude: -0.09 }).success).toBe(true)
      expect(pointSchema.safeParse({ latitude: 51.5, longitude: -0.09, height: 10 }).success).toBe(
        true,
      )
      expect(pointSchema.safeParse({ latitude: 51.5, longitude: -0.09, srid: 4326 }).success).toBe(
        true,
      )
      expect(
        pointSchema.safeParse({ latitude: 51.5, longitude: -0.09, height: 10, srid: 4979 }).success,
      ).toBe(true)
    })

    it('should accept driver Point instances', () => {
      expect(pointSchema.safeParse(new neo4j.Point(7203, 1, 2)).success).toBe(true)
      expect(pointSchema.safeParse(new neo4j.Point(4326, -0.09, 51.5)).success).toBe(true)
    })

    it('should reject SRID mismatches', () => {
      expect(pointSchema.safeParse({ x: 1, y: 2, srid: 4326 }).success).toBe(false)
      expect(pointSchema.safeParse({ latitude: 1, longitude: 2, srid: 7203 }).success).toBe(false)
      expect(pointSchema.safeParse({ x: 1, y: 2, z: 3, srid: 7203 }).success).toBe(false)
      expect(pointSchema.safeParse(new neo4j.Point(9999, 1, 2)).success).toBe(false)
    })

    it('should reject malformed points', () => {
      expect(pointSchema.safeParse({ x: 1 }).success).toBe(false)
      expect(pointSchema.safeParse({ x: 1, latitude: 2 }).success).toBe(false)
      expect(pointSchema.safeParse({ latitude: 51.5 }).success).toBe(false)
      expect(pointSchema.safeParse({ x: 'a', y: 2 }).success).toBe(false)
      expect(pointSchema.safeParse('point').success).toBe(false)
    })
  })

  describe('duration', () => {
    it('should accept plain duration objects with non-negative integers', () => {
      expect(durationSchema.safeParse({}).success).toBe(true)
      expect(
        durationSchema.safeParse({ months: 1, days: 2, seconds: 3, nanoseconds: 4 }).success,
      ).toBe(true)
    })

    it('should reject negative, fractional or non-numeric components', () => {
      expect(durationSchema.safeParse({ months: -1 }).success).toBe(false)
      expect(durationSchema.safeParse({ days: 1.5 }).success).toBe(false)
      expect(durationSchema.safeParse({ seconds: '3' }).success).toBe(false)
    })

    it('should accept driver Duration instances', () => {
      expect(durationSchema.safeParse(new neo4j.Duration(1, 2, 3, 4)).success).toBe(true)
      expect(durationSchema.safeParse('P1D').success).toBe(false)
    })
  })
})
