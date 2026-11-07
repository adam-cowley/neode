import { EntitySchema } from '../../../src/meta/entity/entity-schema'
import { PropertySchema } from '../../../src/meta/property-schema'

describe('EntitySchema', () => {
  describe('labels', () => {
    it('should sort labels when set', () => {
      const schema = new EntitySchema()

      schema.setLabels(['Person', 'Employee'])

      expect(schema.getLabels()).toEqual(['Employee', 'Person'])
    })

    it('should deduplicate labels when set', () => {
      const schema = new EntitySchema()

      schema.setLabels(['Person', 'Employee', 'Person', 'Employee'])

      expect(schema.getLabels()).toEqual(['Employee', 'Person'])
    })

    it('should not mutate the array passed to setLabels', () => {
      const schema = new EntitySchema()
      const labels = ['Person', 'Employee']

      schema.setLabels(labels)

      expect(labels).toEqual(['Person', 'Employee'])
      expect(schema.getLabels()).not.toBe(labels)
    })

    it('should add a label maintaining sort order', () => {
      const schema = new EntitySchema()

      schema.setLabels(['Person'])
      schema.addLabel('Employee')

      expect(schema.getLabels()).toEqual(['Employee', 'Person'])
    })

    it('should add a label at the end of the sort order', () => {
      const schema = new EntitySchema()

      schema.setLabels(['Employee'])
      schema.addLabel('Person')

      expect(schema.getLabels()).toEqual(['Employee', 'Person'])
    })

    it('should not add a duplicate label', () => {
      const schema = new EntitySchema()

      schema.setLabels(['Person'])
      schema.addLabel('Person')

      expect(schema.getLabels()).toEqual(['Person'])
    })

    it('should return a copy of the labels from getLabels()', () => {
      const schema = new EntitySchema()

      schema.setLabels(['Person'])

      schema.getLabels().push('Mutant')

      expect(schema.getLabels()).toEqual(['Person'])
    })
  })

  describe('getPrimaryKey', () => {
    it('should return the explicitly defined primary key', () => {
      const schema = new EntitySchema()
      schema.setLabels(['Person'])

      schema.addProperty('id')
      schema.getProperty('id').setPrimaryKey()

      const primaryKey = schema.getPrimaryKey()

      expect(primaryKey).toBeInstanceOf(PropertySchema)
      expect(primaryKey?.getKey()).toEqual('id')
    })

    it('should prefer the explicit primary key over the fallback name', () => {
      const schema = new EntitySchema()
      schema.setLabels(['Person'])

      schema.addProperty('id')
      schema.getProperty('id').setPrimaryKey()
      schema.addProperty('person_id')

      expect(schema.getPrimaryKey()?.getKey()).toEqual('id')
    })

    it('should fall back to a <first label lowercased>_id primary key', () => {
      const schema = new EntitySchema()
      schema.setLabels(['Person'])

      const primaryKey = schema.getPrimaryKey()

      expect(primaryKey).toBeInstanceOf(PropertySchema)
      expect(primaryKey?.getKey()).toEqual('person_id')
      expect(primaryKey?.isPrimaryKey()).toEqual(true)
    })

    it('should use the first label after sorting for the fallback name', () => {
      const schema = new EntitySchema()
      schema.setLabels(['Person', 'Employee'])

      const primaryKey = schema.getPrimaryKey()

      expect(primaryKey?.getKey()).toEqual('employee_id')
    })

    it('should NOT register the fallback primary key as a schema property', () => {
      const schema = new EntitySchema()
      schema.setLabels(['Person'])

      const primaryKey = schema.getPrimaryKey()

      // The undeclared default is a phantom: it matches by name but is
      // never written, so it must not join getProperties() (a dead unique
      // constraint and a phantom hydrated field would otherwise follow)
      expect(schema.hasProperty('person_id')).toEqual(false)
      expect(primaryKey?.getKey()).toEqual('person_id')
    })

    it('should mark the fallback primary key as unique', () => {
      const schema = new EntitySchema()
      schema.setLabels(['Person'])

      expect(schema.getPrimaryKey()?.isUnique()).toEqual(true)
    })

    it('should be idempotent across calls', () => {
      const schema = new EntitySchema()
      schema.setLabels(['Person'])

      const first = schema.getPrimaryKey()
      const second = schema.getPrimaryKey()

      expect(second).toBe(first)
    })

    it('should return undefined when the schema has no labels', () => {
      const schema = new EntitySchema()

      expect(schema.getPrimaryKey()).toBeUndefined()
    })
  })
})
