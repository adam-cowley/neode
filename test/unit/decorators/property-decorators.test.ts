import {
  NodeEntity,
  Property,
  Boolean,
  Float,
  Date,
  Time,
  DateTime,
  LocalTime,
  LocalDateTime,
  Point,
  Duration,
  Default,
  OnCreateSet,
  OnMatchSet,
  Index,
  Unique,
  Required,
  Hidden,
  Protected,
  Readonly,
  Uuid,
} from '../../../src/decorators'
import { getModel } from '../../../src/meta'
import { PropertySchema, PropertyType } from '../../../src/meta/property-schema'

describe('Property Decorators (NTS-12)', () => {
  describe('@Property', () => {
    @NodeEntity()
    class TypedProperties {
      @Property({ type: 'string' }) propString: string
      @Property({ type: 'number' }) propNumber: number
      @Property({ type: 'int' }) propInt: number
      @Property({ type: 'integer' }) propInteger: number
      @Property({ type: 'float' }) propFloat: number
      @Property({ type: 'boolean' }) propBoolean: boolean
      @Property({ type: 'uuid' }) propUuid: string
      @Property({ type: 'date' }) propDate: string
      @Property({ type: 'time' }) propTime: string
      @Property({ type: 'datetime' }) propDatetime: string
      @Property({ type: 'localtime' }) propLocaltime: string
      @Property({ type: 'localdatetime' }) propLocaldatetime: string
      @Property({ type: 'point' }) propPoint: unknown
      @Property({ type: 'duration' }) propDuration: unknown
      @Property({ type: 'any' }) propAny: unknown
    }

    const cases: Array<[string, PropertyType]> = [
      ['string', PropertyType.STRING],
      ['number', PropertyType.NUMBER],
      ['int', PropertyType.INTEGER],
      ['integer', PropertyType.INTEGER],
      ['float', PropertyType.FLOAT],
      ['boolean', PropertyType.BOOLEAN],
      ['uuid', PropertyType.UUID],
      ['date', PropertyType.DATE],
      ['time', PropertyType.TIME],
      ['datetime', PropertyType.DATETIME],
      ['localtime', PropertyType.LOCALTIME],
      ['localdatetime', PropertyType.LOCALDATETIME],
      ['point', PropertyType.POINT],
      ['duration', PropertyType.DURATION],
      ['any', PropertyType.ANY],
    ]

    it.each(cases)('should register type "%s"', (type, expected) => {
      const property = getModel(TypedProperties).getProperty(
        `prop${type.charAt(0).toUpperCase() + type.slice(1)}`,
      )

      expect(property).toBeInstanceOf(PropertySchema)
      expect(property.getType()).toEqual(expected)
    })

    it('should merge config options onto the property', () => {
      @NodeEntity()
      class ConfiguredProperties {
        @Property({ type: 'string', index: true, required: true })
        configured: string
      }

      const property = getModel(ConfiguredProperties).getProperty('configured')

      expect(property.getType()).toEqual(PropertyType.STRING)
      expect(property.isIndex()).toEqual(true)
      expect(property.isRequired()).toEqual(true)
    })

    it('should throw a helpful error for an unknown type', () => {
      let message = ''

      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        class UnknownProperties {
          @Property({ type: 'nope' })
          bad: string
        }
      } catch (error) {
        message = (error as Error).message
      }

      expect(message).toContain('Unknown property type "nope"')
      expect(message).toContain('string')
      expect(message).toContain('datetime')
    })
  })

  describe('sugar type decorators', () => {
    @NodeEntity()
    class SugarProperties {
      @Boolean() booleanProp: boolean
      @Float() floatProp: number
      @Date() dateProp: string
      @Time() timeProp: string
      @DateTime() dateTimeProp: string
      @LocalTime() localTimeProp: string
      @LocalDateTime() localDateTimeProp: string
      @Point() pointProp: unknown
      @Duration() durationProp: unknown
    }

    it('should register @Boolean', () => {
      expect(getModel(SugarProperties).getProperty('booleanProp').getType()).toEqual(
        PropertyType.BOOLEAN,
      )
    })

    it('should register @Float', () => {
      expect(getModel(SugarProperties).getProperty('floatProp').getType()).toEqual(
        PropertyType.FLOAT,
      )
    })

    it('should register @Date', () => {
      expect(getModel(SugarProperties).getProperty('dateProp').getType()).toEqual(PropertyType.DATE)
    })

    it('should register @Time', () => {
      expect(getModel(SugarProperties).getProperty('timeProp').getType()).toEqual(PropertyType.TIME)
    })

    it('should register @DateTime', () => {
      expect(getModel(SugarProperties).getProperty('dateTimeProp').getType()).toEqual(
        PropertyType.DATETIME,
      )
    })

    it('should register @LocalTime', () => {
      expect(getModel(SugarProperties).getProperty('localTimeProp').getType()).toEqual(
        PropertyType.LOCALTIME,
      )
    })

    it('should register @LocalDateTime', () => {
      expect(getModel(SugarProperties).getProperty('localDateTimeProp').getType()).toEqual(
        PropertyType.LOCALDATETIME,
      )
    })

    it('should register @Point', () => {
      expect(getModel(SugarProperties).getProperty('pointProp').getType()).toEqual(
        PropertyType.POINT,
      )
    })

    it('should register @Duration', () => {
      expect(getModel(SugarProperties).getProperty('durationProp').getType()).toEqual(
        PropertyType.DURATION,
      )
    })
  })

  describe('option decorators', () => {
    @NodeEntity()
    class OptionProperties {
      @Default('foo') literalDefault: string
      @Default(() => 'bar') functionDefault: string
      @OnCreateSet() onCreateProp: string
      @OnMatchSet() onMatchProp: string
      @Index() indexProp: string
      @Unique() uniqueProp: string
      @Required() requiredProp: string
      @Hidden() hiddenProp: string
      @Protected() protectedProp: string
      @Readonly() readonlyProp: string
    }

    it('should set a literal default with @Default', () => {
      const property = getModel(OptionProperties).getProperty('literalDefault')

      expect(property.getDefaultValue()).toEqual('foo')
    })

    it('should set a function default with @Default', () => {
      const property = getModel(OptionProperties).getProperty('functionDefault')

      expect(typeof property.getDefaultValue()).toEqual('function')
    })

    it('should set onCreateSet with @OnCreateSet', () => {
      expect(getModel(OptionProperties).getProperty('onCreateProp').getOnCreateSet()).toEqual(true)
    })

    it('should set onMatchSet with @OnMatchSet', () => {
      expect(getModel(OptionProperties).getProperty('onMatchProp').getOnMatchSet()).toEqual(true)
    })

    it('should set index with @Index', () => {
      expect(getModel(OptionProperties).getProperty('indexProp').isIndex()).toEqual(true)
    })

    it('should set unique with @Unique', () => {
      expect(getModel(OptionProperties).getProperty('uniqueProp').isUnique()).toEqual(true)
    })

    it('should set required with @Required', () => {
      expect(getModel(OptionProperties).getProperty('requiredProp').isRequired()).toEqual(true)
    })

    it('should set hidden with @Hidden', () => {
      expect(getModel(OptionProperties).getProperty('hiddenProp').isHidden()).toEqual(true)
    })

    it('should set protected with @Protected', () => {
      expect(getModel(OptionProperties).getProperty('protectedProp').isProtected()).toEqual(true)
    })

    it('should set readonly with @Readonly', () => {
      expect(getModel(OptionProperties).getProperty('readonlyProp').isReadonly()).toEqual(true)
    })

    it('should not set a type (they merge onto the existing property)', () => {
      const property = getModel(OptionProperties).getProperty('indexProp')

      expect(property.getType()).toEqual(PropertyType.ANY)
    })
  })

  describe('decorator stacking', () => {
    @NodeEntity()
    class StackedProperties {
      @Uuid()
      @Index()
      @Required()
      stackedUuid: string

      @Property({ type: 'string' })
      @Default('x')
      @Unique()
      stackedString: string

      @Index()
      @Property({ type: 'float' })
      indexFirst: number

      @Property({ type: 'string' })
      @Index()
      stringThenIndex: string
    }

    it('should merge @Uuid + @Index + @Required onto one property', () => {
      const property = getModel(StackedProperties).getProperty('stackedUuid')

      expect(property.getType()).toEqual(PropertyType.UUID)
      expect(property.isIndex()).toEqual(true)
      expect(property.isRequired()).toEqual(true)
      expect(typeof property.getDefaultValue()).toEqual('function')
    })

    it('should merge @Property + @Default + @Unique onto one property', () => {
      const property = getModel(StackedProperties).getProperty('stackedString')

      expect(property.getType()).toEqual(PropertyType.STRING)
      expect(property.isUnique()).toEqual(true)
      expect(property.getDefaultValue()).toEqual('x')
    })

    it('should keep the type when the option decorator runs first', () => {
      const property = getModel(StackedProperties).getProperty('indexFirst')

      expect(property.getType()).toEqual(PropertyType.FLOAT)
      expect(property.isIndex()).toEqual(true)
    })

    it('should keep the string type when stacked with option decorators', () => {
      const property = getModel(StackedProperties).getProperty('stringThenIndex')

      expect(property.getType()).toEqual(PropertyType.STRING)
      expect(property.isIndex()).toEqual(true)
    })
  })
})
