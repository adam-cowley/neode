import {
  Date as Neo4jDate,
  DateTime as Neo4jDateTime,
  Duration as Neo4jDuration,
  LocalDateTime as Neo4jLocalDateTime,
  LocalTime as Neo4jLocalTime,
  Point as Neo4jPoint,
  Time as Neo4jTime,
} from 'neo4j-driver'

import { PropertySchema, PropertyType } from '../../../src/meta/property-schema'
import { convertPropertyValue } from '../../../src/utilities'

function property(type: PropertyType, array: boolean = false): PropertySchema {
  const schema = new PropertySchema('value')

  schema.setType(type)
  schema.setArray(array)

  return schema
}

describe('convertPropertyValue', () => {
  describe('temporal types', () => {
    describe('DATE', () => {
      it('converts an ISO date string to a neo4j Date', () => {
        const value = convertPropertyValue('2024-03-15', property(PropertyType.DATE))

        expect(value).toBeInstanceOf(Neo4jDate)
        expect((value as Neo4jDate).toString()).toEqual('2024-03-15')
      })

      it('converts an epoch number to a neo4j Date', () => {
        const epoch = new Date(2024, 2, 15).getTime()
        const value = convertPropertyValue(epoch, property(PropertyType.DATE))

        expect(value).toBeInstanceOf(Neo4jDate)
        expect((value as Neo4jDate).toString()).toEqual('2024-03-15')
      })

      it('converts a JavaScript Date to a neo4j Date', () => {
        const value = convertPropertyValue(new Date(2024, 2, 15), property(PropertyType.DATE))

        expect(value).toBeInstanceOf(Neo4jDate)
        expect((value as Neo4jDate).toString()).toEqual('2024-03-15')
      })

      it('passes through an existing neo4j Date', () => {
        const existing = Neo4jDate.fromString('2024-03-15')

        expect(convertPropertyValue(existing, property(PropertyType.DATE))).toBe(existing)
      })

      it('passes through other values unchanged', () => {
        const value = { something: 'else' }

        expect(convertPropertyValue(value, property(PropertyType.DATE))).toBe(value)
      })
    })

    describe('TIME', () => {
      it('converts a time string with an offset to a neo4j Time', () => {
        const value = convertPropertyValue('12:30:45.123Z', property(PropertyType.TIME))

        expect(value).toBeInstanceOf(Neo4jTime)
        expect((value as Neo4jTime).toString()).toEqual('12:30:45.123000000Z')
      })

      it('converts a JavaScript Date to a neo4j Time', () => {
        const value = convertPropertyValue(
          new Date(2024, 2, 15, 12, 30, 45),
          property(PropertyType.TIME),
        )

        expect(value).toBeInstanceOf(Neo4jTime)
        expect((value as Neo4jTime).hour).toEqual(12)
        expect((value as Neo4jTime).minute).toEqual(30)
        expect((value as Neo4jTime).second).toEqual(45)
      })

      it('passes through an existing neo4j Time', () => {
        const existing = Neo4jTime.fromString('12:30:45.123Z')

        expect(convertPropertyValue(existing, property(PropertyType.TIME))).toBe(existing)
      })
    })

    describe('DATETIME', () => {
      it('converts an ISO datetime string to a neo4j DateTime', () => {
        const value = convertPropertyValue('2024-03-15T12:30:45Z', property(PropertyType.DATETIME))

        expect(value).toBeInstanceOf(Neo4jDateTime)
        expect((value as Neo4jDateTime).toString()).toEqual('2024-03-15T12:30:45Z')
      })

      it('converts a JavaScript Date to a neo4j DateTime', () => {
        const value = convertPropertyValue(
          new Date(2024, 2, 15, 12, 30, 45),
          property(PropertyType.DATETIME),
        )

        expect(value).toBeInstanceOf(Neo4jDateTime)
        expect((value as Neo4jDateTime).year).toEqual(2024)
        expect((value as Neo4jDateTime).month).toEqual(3)
        expect((value as Neo4jDateTime).day).toEqual(15)
        expect((value as Neo4jDateTime).hour).toEqual(12)
      })

      it('passes through an existing neo4j DateTime', () => {
        const existing = Neo4jDateTime.fromString('2024-03-15T12:30:45Z')

        expect(convertPropertyValue(existing, property(PropertyType.DATETIME))).toBe(existing)
      })
    })

    describe('LOCALTIME', () => {
      it('converts a local time string to a neo4j LocalTime', () => {
        const value = convertPropertyValue('12:30:45.123', property(PropertyType.LOCALTIME))

        expect(value).toBeInstanceOf(Neo4jLocalTime)
        expect((value as Neo4jLocalTime).toString()).toEqual('12:30:45.123000000')
      })

      it('converts a JavaScript Date to a neo4j LocalTime', () => {
        const value = convertPropertyValue(
          new Date(2024, 2, 15, 12, 30, 45),
          property(PropertyType.LOCALTIME),
        )

        expect(value).toBeInstanceOf(Neo4jLocalTime)
        expect((value as Neo4jLocalTime).hour).toEqual(12)
        expect((value as Neo4jLocalTime).minute).toEqual(30)
        expect((value as Neo4jLocalTime).second).toEqual(45)
      })

      it('passes through an existing neo4j LocalTime', () => {
        const existing = Neo4jLocalTime.fromString('12:30:45')

        expect(convertPropertyValue(existing, property(PropertyType.LOCALTIME))).toBe(existing)
      })
    })

    describe('LOCALDATETIME', () => {
      it('converts a local datetime string to a neo4j LocalDateTime', () => {
        const value = convertPropertyValue(
          '2024-03-15T12:30:45',
          property(PropertyType.LOCALDATETIME),
        )

        expect(value).toBeInstanceOf(Neo4jLocalDateTime)
        expect((value as Neo4jLocalDateTime).toString()).toEqual('2024-03-15T12:30:45')
      })

      it('converts a JavaScript Date to a neo4j LocalDateTime', () => {
        const value = convertPropertyValue(
          new Date(2024, 2, 15, 12, 30, 45),
          property(PropertyType.LOCALDATETIME),
        )

        expect(value).toBeInstanceOf(Neo4jLocalDateTime)
        expect((value as Neo4jLocalDateTime).year).toEqual(2024)
        expect((value as Neo4jLocalDateTime).hour).toEqual(12)
      })

      it('passes through an existing neo4j LocalDateTime', () => {
        const existing = Neo4jLocalDateTime.fromString('2024-03-15T12:30:45')

        expect(convertPropertyValue(existing, property(PropertyType.LOCALDATETIME))).toBe(existing)
      })
    })

    it('rejects unparseable temporal strings', () => {
      expect(() => convertPropertyValue('not-a-date', property(PropertyType.DATE))).toThrow()
      expect(() => convertPropertyValue('not-a-time', property(PropertyType.TIME))).toThrow()
    })
  })

  describe('POINT', () => {
    it('converts a cartesian 2D point to SRID 7203', () => {
      const value = convertPropertyValue({ x: 1, y: 2 }, property(PropertyType.POINT)) as Neo4jPoint

      expect(value).toBeInstanceOf(Neo4jPoint)
      expect(value.srid).toEqual(7203)
      expect(value.x).toEqual(1)
      expect(value.y).toEqual(2)
      expect(value.z).toBeUndefined()
    })

    it('converts a cartesian 3D point to SRID 9157', () => {
      const value = convertPropertyValue(
        { x: 1, y: 2, z: 3 },
        property(PropertyType.POINT),
      ) as Neo4jPoint

      expect(value).toBeInstanceOf(Neo4jPoint)
      expect(value.srid).toEqual(9157)
      expect(value.x).toEqual(1)
      expect(value.y).toEqual(2)
      expect(value.z).toEqual(3)
    })

    it('converts a WGS 84 2D point to SRID 4326', () => {
      const value = convertPropertyValue(
        { latitude: 51.5, longitude: -0.1 },
        property(PropertyType.POINT),
      ) as Neo4jPoint

      expect(value).toBeInstanceOf(Neo4jPoint)
      expect(value.srid).toEqual(4326)
      // Neo4j geographic points store longitude as x and latitude as y
      expect(value.x).toEqual(-0.1)
      expect(value.y).toEqual(51.5)
      expect(value.z).toBeUndefined()
    })

    it('converts a WGS 84 3D point to SRID 4979', () => {
      const value = convertPropertyValue(
        { latitude: 51.5, longitude: -0.1, height: 10 },
        property(PropertyType.POINT),
      ) as Neo4jPoint

      expect(value).toBeInstanceOf(Neo4jPoint)
      expect(value.srid).toEqual(4979)
      expect(value.x).toEqual(-0.1)
      expect(value.y).toEqual(51.5)
      expect(value.z).toEqual(10)
    })

    it('passes through an existing neo4j Point', () => {
      const existing = new Neo4jPoint(7203, 1, 2)

      expect(convertPropertyValue(existing, property(PropertyType.POINT))).toBe(existing)
    })

    it('rejects values that do not describe a point', () => {
      expect(() => convertPropertyValue('nonsense', property(PropertyType.POINT))).toThrow(
        TypeError,
      )
      expect(() => convertPropertyValue(42, property(PropertyType.POINT))).toThrow(TypeError)
      expect(() => convertPropertyValue({}, property(PropertyType.POINT))).toThrow(TypeError)
      expect(() => convertPropertyValue({ x: 'nope', y: 2 }, property(PropertyType.POINT))).toThrow(
        TypeError,
      )
    })
  })

  describe('DURATION', () => {
    it('converts a duration object to a neo4j Duration', () => {
      const value = convertPropertyValue(
        { months: 1, days: 2, seconds: 3, nanoseconds: 4 },
        property(PropertyType.DURATION),
      ) as Neo4jDuration

      expect(value).toBeInstanceOf(Neo4jDuration)
      expect(value.months).toEqual(1)
      expect(value.days).toEqual(2)
      expect(value.seconds).toEqual(3)
      expect(value.nanoseconds).toEqual(4)
    })

    it('passes through an existing neo4j Duration', () => {
      const existing = new Neo4jDuration(1, 2, 3, 4)

      expect(convertPropertyValue(existing, property(PropertyType.DURATION))).toBe(existing)
    })

    it('rejects values that do not describe a duration', () => {
      expect(() => convertPropertyValue('nonsense', property(PropertyType.DURATION))).toThrow(
        TypeError,
      )
      expect(() => convertPropertyValue({ months: 1 }, property(PropertyType.DURATION))).toThrow(
        TypeError,
      )
      expect(() =>
        convertPropertyValue(
          { months: '1', days: 2, seconds: 3, nanoseconds: 4 },
          property(PropertyType.DURATION),
        ),
      ).toThrow(TypeError)
    })
  })

  describe('numeric types', () => {
    describe('INTEGER', () => {
      it('passes plain integers through as numbers', () => {
        const value = convertPropertyValue(42, property(PropertyType.INTEGER))

        expect(value).toEqual(42)
        expect(typeof value).toEqual('number')
      })

      it('converts numeric strings to numbers', () => {
        expect(convertPropertyValue('42', property(PropertyType.INTEGER))).toEqual(42)
      })

      it('rejects non-integer numbers', () => {
        expect(() => convertPropertyValue(3.5, property(PropertyType.INTEGER))).toThrow(TypeError)
      })

      it('rejects non-numeric values', () => {
        expect(() => convertPropertyValue('nonsense', property(PropertyType.INTEGER))).toThrow(
          TypeError,
        )
        expect(() => convertPropertyValue(true, property(PropertyType.INTEGER))).toThrow(TypeError)
        expect(() => convertPropertyValue({}, property(PropertyType.INTEGER))).toThrow(TypeError)
      })
    })

    describe('FLOAT', () => {
      it('passes numbers through', () => {
        expect(convertPropertyValue(3.14, property(PropertyType.FLOAT))).toEqual(3.14)
        expect(convertPropertyValue(42, property(PropertyType.FLOAT))).toEqual(42)
      })

      it('converts numeric strings to numbers', () => {
        expect(convertPropertyValue('3.14', property(PropertyType.FLOAT))).toEqual(3.14)
        expect(convertPropertyValue('42', property(PropertyType.FLOAT))).toEqual(42)
      })

      it('rejects non-numeric values', () => {
        expect(() => convertPropertyValue('nonsense', property(PropertyType.FLOAT))).toThrow(
          TypeError,
        )
        expect(() => convertPropertyValue(true, property(PropertyType.FLOAT))).toThrow(TypeError)
        expect(() => convertPropertyValue({}, property(PropertyType.FLOAT))).toThrow(TypeError)
      })
    })

    describe('NUMBER', () => {
      it('behaves the same as FLOAT', () => {
        expect(convertPropertyValue(3.14, property(PropertyType.NUMBER))).toEqual(3.14)
        expect(convertPropertyValue('42', property(PropertyType.NUMBER))).toEqual(42)
        expect(() => convertPropertyValue('nonsense', property(PropertyType.NUMBER))).toThrow(
          TypeError,
        )
      })
    })
  })

  describe('string types', () => {
    it('passes STRING values through', () => {
      expect(convertPropertyValue('hello', property(PropertyType.STRING))).toEqual('hello')
    })

    it('passes UUID values through', () => {
      const uuid = 'b3dd6e58-ec92-4be1-b9ea-2f22b6bc6e8d'

      expect(convertPropertyValue(uuid, property(PropertyType.UUID))).toEqual(uuid)
    })
  })

  describe('other types', () => {
    it('passes BOOLEAN values through without coercion', () => {
      expect(convertPropertyValue(true, property(PropertyType.BOOLEAN))).toEqual(true)
    })

    it('passes ANY values through', () => {
      const value = { anything: 'goes' }

      expect(convertPropertyValue(value, property(PropertyType.ANY))).toBe(value)
    })

    it('passes internal identifiers through', () => {
      expect(convertPropertyValue('4:abc:0', property(PropertyType.INTERNAL_ID))).toEqual('4:abc:0')
    })
  })

  describe('nullish values', () => {
    it('passes null and undefined through for every type', () => {
      for (const type of Object.values(PropertyType).filter((v) => typeof v === 'number')) {
        expect(convertPropertyValue(null, property(type as PropertyType))).toBeNull()
        expect(convertPropertyValue(undefined, property(type as PropertyType))).toBeUndefined()
      }
    })
  })

  describe('arrays', () => {
    it('converts each element of an array property', () => {
      const value = convertPropertyValue(
        ['2024-03-15', '2025-01-01'],
        property(PropertyType.DATE, true),
      ) as Neo4jDate[]

      expect(value).toHaveLength(2)
      expect(value[0]).toBeInstanceOf(Neo4jDate)
      expect(value[0].toString()).toEqual('2024-03-15')
      expect(value[1].toString()).toEqual('2025-01-01')
    })

    it('converts each element of a numeric array property', () => {
      expect(convertPropertyValue(['1', '2'], property(PropertyType.INTEGER, true))).toEqual([1, 2])
    })

    it('passes string arrays through', () => {
      expect(convertPropertyValue(['a', 'b'], property(PropertyType.STRING, true))).toEqual([
        'a',
        'b',
      ])
    })

    it('converts a scalar assigned to an array property', () => {
      const value = convertPropertyValue('2024-03-15', property(PropertyType.DATE, true))

      expect(value).toBeInstanceOf(Neo4jDate)
    })

    it('leaves arrays on non-array properties untouched', () => {
      const value = ['a', 'b']

      expect(convertPropertyValue(value, property(PropertyType.STRING))).toBe(value)
    })
  })
})
