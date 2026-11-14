import { getModel, mergeProperty } from '../../../src/meta'
import { defineModel } from '../../../src/meta/map-schema'
import { PropertyType } from '../../../src/meta/property-schema'
import { Required, Property } from '../../../src/decorators'
import { validate } from '../../../src/validation'
import { ValidationError } from '../../../src/validation/validation-error'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

class WiringUnitUser {
  @Property({ type: 'string', min: 2, email: true })
  email: string

  @Property({ type: 'string' })
  @Required()
  name: string
}

// ----------------------------------------------------------------------------

describe('rule persistence through the metamodel', () => {
  it('stores config keys unknown to the metamodel as rules (mergeProperty)', () => {
    const property = mergeProperty(class {}, 'email', PropertyType.STRING, {
      min: 2,
      email: true,
    })

    expect(property.getRules()).toEqual({ min: 2, email: true })
  })

  it('does not leak metamodel flags into the rules', () => {
    const property = mergeProperty(class {}, 'name', PropertyType.STRING, {
      required: true,
      unique: true,
    })

    expect(property.getRules()).toEqual({})
  })

  it('merges successive setRules calls', () => {
    class MergeTarget {}

    const property = mergeProperty(MergeTarget, 'email', PropertyType.STRING, { min: 2 })
    mergeProperty(MergeTarget, 'email', PropertyType.ANY, { email: true })

    expect(property.getRules()).toEqual({ min: 2, email: true })
  })

  it('persists rules from decorator-configured properties', () => {
    const property = getModel(WiringUnitUser).getProperty('email')

    expect(property.getRules()).toEqual({ min: 2, email: true })
  })

  it('persists rules from map-defined models', () => {
    const Person = defineModel('WiringUnitMapUser', {
      email: { type: 'string', email: true },
    })

    expect(getModel(Person).getProperty('email').getRules()).toEqual({ email: true })
  })
})

describe('validate() reading rules from the metamodel', () => {
  const schema = getModel(WiringUnitUser)

  it('enforces the persisted rules', () => {
    expect(() => validate({ email: 'not-an-email', name: 'Adam' }, schema)).toThrow(ValidationError)
    expect(() => validate({ email: 'ab', name: 'Adam' }, schema)).toThrow(ValidationError)
  })

  it('passes values that satisfy the rules', () => {
    expect(() => validate({ email: 'adam@example.com', name: 'Adam' }, schema)).not.toThrow()
  })

  it('still enforces type and required alongside the rules', () => {
    expect(() => validate({ email: 5, name: 'Adam' }, schema)).toThrow(ValidationError)

    expect(() => validate({ email: 'adam@example.com' }, schema)).toThrow(ValidationError)

    try {
      validate({ email: 'adam@example.com' }, schema)
    } catch (error) {
      expect((error as ValidationError).issues).toEqual([
        expect.objectContaining({ message: '"name" is required', path: ['name'] }),
      ])
    }
  })
})
