import neo4j from 'neo4j-driver'

import { EntitySchema } from '../../../src/meta/entity/entity-schema'
import { PropertySchema, PropertyType } from '../../../src/meta/property-schema'
import { validate } from '../../../src/validation'
import { ValidationError } from '../../../src/validation/validation-error'

function addProperty(
  schema: EntitySchema,
  key: string,
  type: PropertyType,
  required = false,
): PropertySchema {
  schema.addProperty(key)

  const property = schema.getProperty(key)

  property.setType(type)
  property.setRequired(required)

  return property
}

function schemaWith(configure: (schema: EntitySchema) => void): EntitySchema {
  const schema = new EntitySchema()

  configure(schema)

  return schema
}

describe('validate', () => {
  describe('required/optional', () => {
    it('should fail when a required property is undefined', () => {
      const schema = schemaWith((model) => addProperty(model, 'name', PropertyType.STRING, true))

      expect(() => validate({}, schema)).toThrow(ValidationError)

      try {
        validate({}, schema)
      } catch (error) {
        const validationError = error as ValidationError

        expect(validationError.issues).toHaveLength(1)
        expect(validationError.issues[0]).toEqual({
          message: '"name" is required',
          path: ['name'],
          rule: 'required',
        })
      }
    })

    it('should pass when an optional property is undefined', () => {
      const schema = schemaWith((model) => addProperty(model, 'name', PropertyType.STRING))

      expect(() => validate({}, schema)).not.toThrow()
    })

    it('should pass when an optional property is null but fail when required', () => {
      const optional = schemaWith((model) => addProperty(model, 'name', PropertyType.STRING))
      const required = schemaWith((model) => addProperty(model, 'name', PropertyType.STRING, true))

      expect(() => validate({ name: null }, optional)).not.toThrow()

      try {
        validate({ name: null }, required)
        throw new Error('should have thrown')
      } catch (error) {
        expect((error as ValidationError).issues[0].message).toEqual('"name" is required')
      }
    })

    it('should treat empty strings as unset', () => {
      const schema = schemaWith((model) => addProperty(model, 'name', PropertyType.STRING, true))

      try {
        validate({ name: '' }, schema)
        throw new Error('should have thrown')
      } catch (error) {
        expect((error as ValidationError).issues[0].message).toEqual('"name" is required')
      }
    })
  })

  describe('issue collection', () => {
    it('should collect one issue per invalid property (abortEarly: false)', () => {
      const schema = schemaWith((model) => {
        addProperty(model, 'name', PropertyType.STRING)
        addProperty(model, 'age', PropertyType.INTEGER)
      })

      try {
        validate({ name: 5, age: 'old' }, schema)
        throw new Error('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        expect((error as ValidationError).issues).toHaveLength(2)
      }
    })

    it('should expose message, path and rule on each issue — the neode-owned shape (NTS-676)', () => {
      const schema = schemaWith((model) => addProperty(model, 'name', PropertyType.STRING))

      try {
        validate({ name: 5 }, schema)
        throw new Error('should have thrown')
      } catch (error) {
        const [issue] = (error as ValidationError).issues

        expect(issue.path).toEqual(['name'])
        expect(issue.rule).toEqual('type')
        expect(typeof issue.message).toEqual('string')
        expect(issue.message.length).toBeGreaterThan(0)
      }
    })

    it('should name the failing neode rule, not the Zod issue code (NTS-676)', () => {
      const schema = schemaWith((model) => addProperty(model, 'email', PropertyType.STRING))
      schema.getProperty('email').setRules({ email: true })

      try {
        validate({ email: 'not-an-email' }, schema)
        throw new Error('should have thrown')
      } catch (error) {
        const [issue] = (error as ValidationError).issues

        expect(issue.rule).toEqual('email')
      }
    })

    it('should preserve the original input', () => {
      const schema = schemaWith((model) => addProperty(model, 'name', PropertyType.STRING))
      const properties = { name: 5 }

      try {
        validate(properties, schema)
        throw new Error('should have thrown')
      } catch (error) {
        expect((error as ValidationError).input).toBe(properties)
      }
    })

    it('should include the property keys in the error message', () => {
      const schema = schemaWith((model) => {
        addProperty(model, 'name', PropertyType.STRING, true)
        addProperty(model, 'age', PropertyType.INTEGER, true)
      })

      try {
        validate({}, schema)
        throw new Error('should have thrown')
      } catch (error) {
        const message = (error as ValidationError).message

        expect(message).toContain('ERROR_VALIDATION')
        expect(message).toContain('"name"')
        expect(message).toContain('"age"')
      }
    })
  })

  describe('unknown keys', () => {
    it('should never fail on unknown keys (allowUnknown)', () => {
      const schema = schemaWith((model) => addProperty(model, 'name', PropertyType.STRING))

      expect(() => validate({ name: 'Adam', ghost: { deep: true } }, schema)).not.toThrow()
    })
  })

  describe('skipped property types', () => {
    it('should skip relationship, node and internal-id types', () => {
      const schema = schemaWith((model) => {
        addProperty(model, 'id', PropertyType.INTERNAL_ID)
        addProperty(model, 'friend', PropertyType.NODE)
        addProperty(model, 'rel', PropertyType.RELATIONSHIP)
        addProperty(model, 'start', PropertyType.START_NODE)
        addProperty(model, 'other', PropertyType.OTHER_NODE)
        addProperty(model, 'many', PropertyType.ONE_TO_MANY)
      })

      expect(() =>
        validate({ id: {}, friend: 'garbage', rel: 5, start: [], other: null, many: 'x' }, schema),
      ).not.toThrow()
    })
  })

  describe('type bases through validate()', () => {
    it('should validate UUID format', () => {
      const schema = schemaWith((model) => addProperty(model, 'id', PropertyType.UUID))

      expect(() => validate({ id: '3f8a5c92-4d1e-4a6b-9c2f-7e8d1a2b3c4d' }, schema)).not.toThrow()
      expect(() => validate({ id: 'nope' }, schema)).toThrow(ValidationError)
    })

    it('should reject 3.5 for integer properties', () => {
      const schema = schemaWith((model) => addProperty(model, 'age', PropertyType.INTEGER))

      expect(() => validate({ age: 3.5 }, schema)).toThrow(ValidationError)
      expect(() => validate({ age: 3 }, schema)).not.toThrow()
    })

    it('should accept temporal ISO strings', () => {
      const schema = schemaWith((model) => {
        addProperty(model, 'born', PropertyType.DATE)
        addProperty(model, 'at', PropertyType.DATETIME)
      })

      expect(() =>
        validate({ born: '2020-06-15', at: '2020-06-15T10:30:00Z' }, schema),
      ).not.toThrow()
      expect(() => validate({ born: 'not-a-date', at: '2020-06-15T10:30:00Z' }, schema)).toThrow(
        ValidationError,
      )
    })

    it('should pass already-converted driver instances through', () => {
      const schema = schemaWith((model) => {
        addProperty(model, 'born', PropertyType.DATE)
        addProperty(model, 'at', PropertyType.DATETIME)
        addProperty(model, 'location', PropertyType.POINT)
        addProperty(model, 'lifespan', PropertyType.DURATION)
        addProperty(model, 'count', PropertyType.INTEGER)
      })

      expect(() =>
        validate(
          {
            born: new neo4j.Date(2020, 5, 15),
            at: neo4j.DateTime.fromStandardDate(new Date()),
            location: new neo4j.Point(7203, 1, 2),
            lifespan: new neo4j.Duration(1, 2, 3, 4),
            count: neo4j.int(7),
          },
          schema,
        ),
      ).not.toThrow()
    })

    it('should validate point SRID consistency', () => {
      const schema = schemaWith((model) => addProperty(model, 'location', PropertyType.POINT))

      expect(() => validate({ location: { x: 1, y: 2 } }, schema)).not.toThrow()
      expect(() =>
        validate({ location: { latitude: 51.5, longitude: -0.09 } }, schema),
      ).not.toThrow()
      expect(() => validate({ location: { x: 1, y: 2, srid: 4326 } }, schema)).toThrow(
        ValidationError,
      )
    })

    it('should validate array elements and report the element path', () => {
      const schema = schemaWith((model) => {
        const property = addProperty(model, 'names', PropertyType.STRING)

        property.setArray()
      })

      expect(() => validate({ names: ['ab', 'cd'] }, schema)).not.toThrow()

      try {
        validate({ names: ['ab', 5] }, schema)
        throw new Error('should have thrown')
      } catch (error) {
        const [issue] = (error as ValidationError).issues

        expect(issue.path).toEqual(['names', '1'])
      }
    })
  })
})
