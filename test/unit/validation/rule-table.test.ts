import neo4j from 'neo4j-driver'

import { PropertySchema, PropertyType } from '../../../src/meta/property-schema'
import { buildPropertySchema } from '../../../src/validation/rule-table'

function prop(type: PropertyType, key = 'name'): PropertySchema {
  const property = new PropertySchema(key)

  property.setType(type)

  return property
}

describe('rule-table', () => {
  describe('chains', () => {
    it('should apply min, max and email together on a string', () => {
      const schema = buildPropertySchema(prop(PropertyType.STRING), {
        min: 2,
        max: 50,
        email: true,
      })

      expect(schema.safeParse('adam@neo4j.com').success).toBe(true)
    })

    it('should collect every failing rule on one property', () => {
      const schema = buildPropertySchema(prop(PropertyType.STRING), {
        min: 2,
        max: 50,
        email: true,
      })

      const result = schema.safeParse('a')

      expect(result.success).toBe(false)
      expect(result.error?.issues).toHaveLength(2)
    })

    it('should build a schema for a property with no rules', () => {
      const schema = buildPropertySchema(prop(PropertyType.STRING))

      expect(schema.safeParse('anything').success).toBe(true)
      expect(schema.safeParse(5).success).toBe(false)
    })
  })

  describe('unknown rules', () => {
    it("should throw with neode's error style for unknown rules", () => {
      expect(() => buildPropertySchema(prop(PropertyType.STRING), { banana: true })).toThrow(
        'Cannot validate property "name": unknown validation rule "banana"',
      )
    })

    it('should throw for rules the base type does not support', () => {
      expect(() => buildPropertySchema(prop(PropertyType.STRING), { precision: 2 })).toThrow(
        'Cannot validate property "name": unknown validation rule "precision"',
      )
      expect(() => buildPropertySchema(prop(PropertyType.POINT), { min: 2 })).toThrow(
        'Cannot validate property "name": unknown validation rule "min"',
      )
    })

    it('should skip boolean-style rules set to false instead of applying them', () => {
      const schema = buildPropertySchema(prop(PropertyType.STRING), { email: false })

      expect(schema.safeParse('not-an-email').success).toBe(true)
    })

    it('should treat required/optional/strip/strict as recognised no-ops', () => {
      const schema = buildPropertySchema(prop(PropertyType.STRING), {
        required: true,
        optional: false,
        strip: false,
        strict: true,
      })

      expect(schema.safeParse('x').success).toBe(true)
    })
  })

  describe('number rules', () => {
    it('should apply min and max', () => {
      const schema = buildPropertySchema(prop(PropertyType.NUMBER), { min: 0, max: 150 })

      expect(schema.safeParse(50).success).toBe(true)
      expect(schema.safeParse(-1).success).toBe(false)
      expect(schema.safeParse(200).success).toBe(false)
    })

    it('should apply multiple, positive, negative and port', () => {
      expect(
        buildPropertySchema(prop(PropertyType.NUMBER), { multiple: 3 }).safeParse(9).success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.NUMBER), { multiple: 3 }).safeParse(7).success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.NUMBER), { positive: true }).safeParse(1).success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.NUMBER), { positive: true }).safeParse(0).success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.NUMBER), { negative: true }).safeParse(-1).success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.NUMBER), { port: true }).safeParse(8080).success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.NUMBER), { port: true }).safeParse(65536).success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.NUMBER), { port: true }).safeParse(8080.5).success,
      ).toBe(false)
    })

    it('should apply precision and the integer rule', () => {
      expect(
        buildPropertySchema(prop(PropertyType.FLOAT), { precision: 2 }).safeParse(1.23).success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.FLOAT), { precision: 2 }).safeParse(1.234).success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.NUMBER), { integer: true }).safeParse(3.5).success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.NUMBER), { integer: true }).safeParse(3).success,
      ).toBe(true)
    })

    it('should support min/max on neo4j Integer instances', () => {
      const schema = buildPropertySchema(prop(PropertyType.INTEGER), { min: 5, max: 10 })

      expect(schema.safeParse(neo4j.int(7)).success).toBe(true)
      expect(schema.safeParse(neo4j.int(3)).success).toBe(false)
    })
  })

  describe('string rules', () => {
    it('should apply min, max and length as length rules', () => {
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { min: 2 }).safeParse('ab').success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { min: 2 }).safeParse('a').success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { max: 3 }).safeParse('abc').success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { max: 3 }).safeParse('abcd').success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { length: 3 }).safeParse('abc').success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { length: 3 }).safeParse('ab').success,
      ).toBe(false)
    })

    it('should apply regex with pattern, invert and name', () => {
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { regex: /^[a-z]+$/ }).safeParse('abc')
          .success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { regex: /^[a-z]+$/ }).safeParse('ab1')
          .success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), {
          regex: { pattern: /\d/, invert: true },
        }).safeParse('abc').success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), {
          regex: { pattern: /\d/, invert: true },
        }).safeParse('ab1').success,
      ).toBe(false)

      const named = buildPropertySchema(prop(PropertyType.STRING), {
        regex: { pattern: /^[a-z]+$/, name: 'letters' },
      })
      const result = named.safeParse('ab1')

      expect(result.success).toBe(false)
      expect(result.error?.issues[0].message).toContain('letters')
    })

    it('should apply alphanum, token, hex, base64, hostname, creditCard and isoDate', () => {
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { alphanum: true }).safeParse('abc123')
          .success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { alphanum: true }).safeParse('abc-123')
          .success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { token: true }).safeParse('a_1').success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { token: true }).safeParse('a-1').success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { hex: true }).safeParse('deadBEEF').success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { hex: true }).safeParse('dead beef')
          .success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { base64: true }).safeParse('aGVsbG8=')
          .success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { base64: true }).safeParse('not base64!!')
          .success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { hostname: true }).safeParse('example.com')
          .success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { hostname: true }).safeParse(
          'has_underscore',
        ).success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { creditCard: true }).safeParse(
          '4242424242424242',
        ).success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { creditCard: true }).safeParse(
          '4242424242424241',
        ).success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { isoDate: true }).safeParse('2020-01-01')
          .success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { isoDate: true }).safeParse('01/01/2020')
          .success,
      ).toBe(false)
    })

    it('should apply email, uri and ip as format checks', () => {
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { email: true }).safeParse('a@b.com')
          .success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { email: true }).safeParse('not-an-email')
          .success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { uri: true }).safeParse('https://neo4j.com')
          .success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { uri: true }).safeParse('not a uri')
          .success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { ip: true }).safeParse('192.168.0.1')
          .success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { ip: true }).safeParse('::1').success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { ip: true }).safeParse('999.1.1.1').success,
      ).toBe(false)
    })

    it('should apply guid (with uuidv4 version) to strings', () => {
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { guid: true }).safeParse(
          '3f8a5c92-4d1e-4a6b-9c2f-7e8d1a2b3c4d',
        ).success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { guid: { version: 'uuidv4' } }).safeParse(
          '3f8a5c92-4d1e-4a6b-9c2f-7e8d1a2b3c4d',
        ).success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.STRING), { guid: true }).safeParse('nope').success,
      ).toBe(false)
    })

    it('should apply lowercase, uppercase, trim, normalize and truncate as transforms', () => {
      const cased = buildPropertySchema(prop(PropertyType.STRING), { trim: true, lowercase: true })

      expect(cased.parse('  ADAM  ')).toEqual('adam')

      const upper = buildPropertySchema(prop(PropertyType.STRING), { uppercase: true })

      expect(upper.parse('adam')).toEqual('ADAM')

      const normalized = buildPropertySchema(prop(PropertyType.STRING), { normalize: 'NFD' })

      expect(normalized.parse('adam')).toEqual('adam')
    })

    it('should truncate to the max limit', () => {
      const schema = buildPropertySchema(prop(PropertyType.STRING), { max: 2, truncate: true })

      expect(schema.parse('abcdef')).toEqual('ab')
    })
  })

  describe('value lists', () => {
    it('should apply valid as a whitelist', () => {
      const schema = buildPropertySchema(prop(PropertyType.STRING), { valid: ['a', 'b'] })

      expect(schema.safeParse('a').success).toBe(true)
      expect(schema.safeParse('c').success).toBe(false)
      expect(schema.safeParse('c').error?.issues[0].message).toContain('must be one of')
    })

    it('should apply invalid as a blacklist', () => {
      const schema = buildPropertySchema(prop(PropertyType.STRING), { invalid: ['nope'] })

      expect(schema.safeParse('ok').success).toBe(true)
      expect(schema.safeParse('nope').success).toBe(false)
    })

    it('should apply allow as a bypass of other rules', () => {
      const schema = buildPropertySchema(prop(PropertyType.NUMBER), { min: 5, allow: 'n/a' })

      expect(schema.safeParse('n/a').success).toBe(true)
      expect(schema.safeParse(3).success).toBe(false)
    })

    it('should apply forbidden to any present value', () => {
      const schema = buildPropertySchema(prop(PropertyType.STRING), { forbidden: true })

      expect(schema.safeParse('anything').success).toBe(false)
    })

    it('should honour the insensitive flag when comparing valid values', () => {
      const schema = buildPropertySchema(prop(PropertyType.STRING), {
        valid: ['Yes', 'No'],
        insensitive: true,
      })

      expect(schema.safeParse('yes').success).toBe(true)
      expect(schema.safeParse('maybe').success).toBe(false)
    })
  })

  describe('boolean rules', () => {
    it('should apply truthy and falsy', () => {
      expect(
        buildPropertySchema(prop(PropertyType.BOOLEAN), { truthy: true }).safeParse(true).success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.BOOLEAN), { truthy: true }).safeParse(false).success,
      ).toBe(false)
      expect(
        buildPropertySchema(prop(PropertyType.BOOLEAN), { falsy: true }).safeParse(false).success,
      ).toBe(true)
      expect(
        buildPropertySchema(prop(PropertyType.BOOLEAN), { falsy: true }).safeParse(true).success,
      ).toBe(false)
    })
  })

  describe('temporal rules', () => {
    it('should apply before and after boundaries', () => {
      const schema = buildPropertySchema(prop(PropertyType.DATETIME), {
        after: '2020-01-01T00:00:00Z',
        before: '2030-01-01T00:00:00Z',
      })

      expect(schema.safeParse('2024-06-15T00:00:00Z').success).toBe(true)
      expect(schema.safeParse('2019-06-15T00:00:00Z').success).toBe(false)
      expect(schema.safeParse('2031-06-15T00:00:00Z').success).toBe(false)
    })

    it('should support "now" as a boundary', () => {
      const schema = buildPropertySchema(prop(PropertyType.DATETIME), { after: 'now' })

      expect(schema.safeParse(new Date(Date.now() + 10000)).success).toBe(true)
      expect(schema.safeParse(new Date(Date.now() - 10000)).success).toBe(false)
    })

    it('should accept driver instances against boundaries', () => {
      const schema = buildPropertySchema(prop(PropertyType.DATE), { after: '2000-01-01' })

      expect(schema.safeParse(new neo4j.Date(2020, 5, 15)).success).toBe(true)
    })
  })

  describe('arrays', () => {
    it('should apply rules to array elements', () => {
      const property = prop(PropertyType.STRING)

      property.setArray()

      const schema = buildPropertySchema(property, { min: 2 })

      expect(schema.safeParse(['ab', 'cd']).success).toBe(true)
      expect(schema.safeParse(['ab', 'a']).success).toBe(false)
      expect(schema.safeParse(['ab', 'a']).error?.issues[0].path).toEqual([1])
      expect(schema.safeParse('ab').success).toBe(false)
    })
  })

  describe('uuid base', () => {
    it('should validate uuid format and still chain string rules', () => {
      const schema = buildPropertySchema(prop(PropertyType.UUID), { min: 20 })

      expect(schema.safeParse('3f8a5c92-4d1e-4a6b-9c2f-7e8d1a2b3c4d').success).toBe(true)
      expect(schema.safeParse('nope').success).toBe(false)
      expect(schema.safeParse('too-short').success).toBe(false)
    })
  })
})
