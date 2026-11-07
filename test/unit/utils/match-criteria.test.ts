import { EntitySchema } from '../../../src/meta/entity/entity-schema'
import { PropertyType } from '../../../src/meta/property-schema'
import { GraphNode } from '../../../src/driver/types'
import { hydrateNode, matchCriteriaForEntity } from '../../../src/utilities'
import { elementIdOfEntity } from '../../../src/element-id'
import { ELEMENT_ID } from '../../../src/constants'

// ---- Fixtures ----------------------------------------------------------------

class Widget {
  id?: string
}

const schema = (): EntitySchema => {
  const entitySchema = new EntitySchema()

  entitySchema.setLabels(['Widget'])
  entitySchema.addProperty('id')
  entitySchema.getProperty('id').setPrimaryKey()

  return entitySchema
}

const node = (): GraphNode => ({
  elementId: '4:unit-1',
  labels: ['Widget'],
  properties: { id: 'w-1' },
})

// ------------------------------------------------------------------------------

describe('elementIdOfEntity / matchCriteriaForEntity', () => {
  it('hydration stashes a non-enumerable elementId used for matching', () => {
    const entity = hydrateNode(schema(), Widget, node())

    expect((entity as Record<symbol, unknown>)[ELEMENT_ID]).toBe('4:unit-1')
    // Not data: invisible to enumeration, serialisation and spread copies
    expect(Object.getOwnPropertyDescriptor(entity, ELEMENT_ID)?.enumerable).toBe(false)

    const criteria = matchCriteriaForEntity(schema(), entity)

    expect(criteria.elementId).toBe('4:unit-1')
  })

  it('resolves the elementId without any @InternalId property', () => {
    const entity = hydrateNode(schema(), Widget, node())

    expect(elementIdOfEntity(schema(), entity)).toBe('4:unit-1')
  })

  it('still honours the deprecated @InternalId property when no stash exists', () => {
    const entitySchema = schema()

    entitySchema.addProperty('_id')
    entitySchema.getProperty('_id').setType(PropertyType.INTERNAL_ID)

    const entity = new Widget()
    ;(entity as Record<string, unknown>).id = 'w-1'
    ;(entity as Record<string, unknown>)._id = '4:legacy-1'

    expect(elementIdOfEntity(entitySchema, entity)).toBe('4:legacy-1')
    expect(matchCriteriaForEntity(entitySchema, entity).elementId).toBe('4:legacy-1')
  })

  it('falls back to the primary key when the entity has no elementId', () => {
    const entity = new Widget()
    entity.id = 'w-1'

    const criteria = matchCriteriaForEntity(schema(), entity)

    expect(criteria.elementId).toBeUndefined()
    expect(criteria.key).toBe('id')
    expect(criteria.value).toBe('w-1')
  })

  it('throws when there is no elementId and no primary key value', () => {
    const entity = new Widget()

    expect(() => matchCriteriaForEntity(schema(), entity)).toThrow(/primary key value/i)
  })

  it('does not throw for a hydrated entity whose schema has no primary key', () => {
    const pkLess = new EntitySchema()

    pkLess.setLabels(['Widget'])

    const entity = hydrateNode(pkLess, Widget, node())

    expect(matchCriteriaForEntity(pkLess, entity).elementId).toBe('4:unit-1')
  })
})
