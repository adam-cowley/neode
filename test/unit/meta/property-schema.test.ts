import { NodeEntity, String, Uuid } from '../../../src/decorators'
import { getModel } from '../../../src/meta'
import { PropertySchema } from '../../../src/meta/property-schema'

describe('PropertySchema', () => {
  describe('options', () => {
    it('should default every option to false', () => {
      const property = new PropertySchema('field')

      expect(property.isRequired()).toEqual(false)
      expect(property.isHidden()).toEqual(false)
      expect(property.isProtected()).toEqual(false)
      expect(property.isReadonly()).toEqual(false)
      expect(property.isIndex()).toEqual(false)
      expect(property.isExists()).toEqual(false)
    })

    describe('required', () => {
      it('should default to true when set without arguments', () => {
        const property = new PropertySchema('field')

        property.setRequired()

        expect(property.isRequired()).toEqual(true)
      })

      it('should round trip explicit values', () => {
        const property = new PropertySchema('field')

        property.setRequired(true)
        expect(property.isRequired()).toEqual(true)

        property.setRequired(false)
        expect(property.isRequired()).toEqual(false)
      })
    })

    describe('hidden', () => {
      it('should default to true when set without arguments', () => {
        const property = new PropertySchema('field')

        property.setHidden()

        expect(property.isHidden()).toEqual(true)
      })

      it('should round trip explicit values', () => {
        const property = new PropertySchema('field')

        property.setHidden(true)
        expect(property.isHidden()).toEqual(true)

        property.setHidden(false)
        expect(property.isHidden()).toEqual(false)
      })
    })

    describe('protected', () => {
      it('should default to true when set without arguments', () => {
        const property = new PropertySchema('field')

        property.setProtected()

        expect(property.isProtected()).toEqual(true)
      })

      it('should round trip explicit values', () => {
        const property = new PropertySchema('field')

        property.setProtected(true)
        expect(property.isProtected()).toEqual(true)

        property.setProtected(false)
        expect(property.isProtected()).toEqual(false)
      })
    })

    describe('readonly', () => {
      it('should default to true when set without arguments', () => {
        const property = new PropertySchema('field')

        property.setReadonly()

        expect(property.isReadonly()).toEqual(true)
      })

      it('should round trip explicit values', () => {
        const property = new PropertySchema('field')

        property.setReadonly(true)
        expect(property.isReadonly()).toEqual(true)

        property.setReadonly(false)
        expect(property.isReadonly()).toEqual(false)
      })
    })

    describe('index', () => {
      it('should default to true when set without arguments', () => {
        const property = new PropertySchema('field')

        property.setIndex()

        expect(property.isIndex()).toEqual(true)
      })

      it('should round trip explicit values', () => {
        const property = new PropertySchema('field')

        property.setIndex(true)
        expect(property.isIndex()).toEqual(true)

        property.setIndex(false)
        expect(property.isIndex()).toEqual(false)
      })
    })

    describe('exists', () => {
      it('should default to true when set without arguments', () => {
        const property = new PropertySchema('field')

        property.setExists()

        expect(property.isExists()).toEqual(true)
      })

      it('should round trip explicit values', () => {
        const property = new PropertySchema('field')

        property.setExists(true)
        expect(property.isExists()).toEqual(true)

        property.setExists(false)
        expect(property.isExists()).toEqual(false)
      })
    })
  })

  describe('decorator config round trip', () => {
    @NodeEntity()
    class OptionEntity {
      @String({ required: true })
      requiredField: string

      @String({ hidden: true })
      hiddenField: string

      @String({ protected: true })
      protectedField: string

      @Uuid({ readonly: true })
      readonlyField: string

      @String({ index: true })
      indexField: string

      @String({ exists: true })
      existsField: string

      @String({ required: false })
      explicitFalseField: string
    }

    it('should apply each option through the decorator config', () => {
      const model = getModel(OptionEntity)

      expect(model.getProperty('requiredField').isRequired()).toEqual(true)
      expect(model.getProperty('hiddenField').isHidden()).toEqual(true)
      expect(model.getProperty('protectedField').isProtected()).toEqual(true)
      expect(model.getProperty('readonlyField').isReadonly()).toEqual(true)
      expect(model.getProperty('indexField').isIndex()).toEqual(true)
      expect(model.getProperty('existsField').isExists()).toEqual(true)
    })

    it('should not set an option explicitly set to false', () => {
      expect(getModel(OptionEntity).getProperty('explicitFalseField').isRequired()).toEqual(false)
    })
  })
})
