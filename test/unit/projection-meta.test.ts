import {
  Computed,
  Expression,
  InternalId,
  LabelPresent,
  NodeEntity,
  Property,
  RelatedMany,
  RelatedOne,
  RelationshipCount,
  RelationshipExists,
} from '../../src/decorators'
import { getModel } from '../../src/meta'
import { EntitySchema } from '../../src/meta/entity/entity-schema'
import { defineModel } from '../../src/meta/map-schema'
import { Newable } from '../../src/meta/newable'
import { PropertyType } from '../../src/meta/property-schema'
import { Direction } from '../../src/query'

/**
 * Projection decorator registration (NTS-135/136/137/138): every read-model
 * decorator lands in the metamodel as a PropertySchema entry with its
 * projection configuration attached, and the map-based definition API can
 * express the same intent (golden parity, extended to projected properties).
 */

@NodeEntity()
class ProjectionMetaCourse {
  @InternalId() _id: string
  @Property({ type: 'string' }) title: string
  @Property({ type: 'string' }) status: string
}

@NodeEntity()
class ProjectionMetaLesson {
  @InternalId() _id: string
  @Property({ type: 'string' }) slug: string
}

@NodeEntity()
class ProjectionMetaStudent {
  @InternalId() _id: string

  @RelatedOne({
    type: 'IN_COURSE',
    direction: 'out',
    fields: ['title', 'status'],
    target: () => ProjectionMetaCourse,
  })
  course: { title: string; status: string }

  @RelatedMany({ type: 'COMPLETED_LESSON', fields: ['slug'] })
  completedLessons: string[]

  @RelatedMany({
    type: 'COHORT',
    direction: 'in',
    fields: ['slug', 'title'],
    target: () => ProjectionMetaLesson,
  })
  cohortLessons: { slug: string; title: string }[]

  @RelatedOne({ type: 'IN_COURSE', direction: 'out', target: () => ProjectionMetaCourse })
  fullCourse: ProjectionMetaCourse

  @RelatedMany({ type: 'COMPLETED_LESSON', direction: 'out', target: () => ProjectionMetaLesson })
  allLessons: ProjectionMetaLesson[]

  @RelationshipCount({ type: 'HAS_MODULE|HAS_LESSON', direction: 'out' })
  materialCount: number

  @RelationshipCount({
    type: 'COMPLETED_LESSON',
    direction: 'out',
    target: () => ProjectionMetaLesson,
    where: 'NOT node:OptionalLesson',
    minHops: 1,
    maxHops: 2,
  })
  requiredLessonsCount: number

  @RelationshipCount({ type: 'CHAIN', direction: 'out', minHops: 2, maxHops: 2 })
  twoHopCount: number

  @RelationshipExists({ type: 'NEXT_LESSON', direction: 'out', where: 'NOT node:OptionalLesson' })
  hasNextLesson: boolean

  @LabelPresent('Flagged')
  isFlagged: boolean

  @Expression('size((this)-[:COMPLETED_LESSON]->())')
  completedTotal: number

  @Computed((entity: ProjectionMetaStudent) => `${entity.completedTotal ?? 0} completed`)
  summary: string
}

function propertyState(schema: EntitySchema, key: string) {
  const property = schema.getProperty(key)

  return {
    type: property.getType(),
    relationshipType: property.getRelationshipType(),
    direction: property.getDirection(),
    fields: property.getFields(),
    where: property.getWhere(),
    minHops: property.getMinHops(),
    maxHops: property.getMaxHops(),
    label: property.getLabel(),
    expression: property.getExpression(),
    targetLabels: property.getEntity() ? getModel(property.getEntity()).getLabels() : undefined,
  }
}

describe('projection decorators: metamodel registration (NTS-135/136/137/138)', () => {
  it('@RelatedOne with fields registers a subset projection', () => {
    const schema = getModel(ProjectionMetaStudent)

    expect(propertyState(schema, 'course')).toEqual({
      type: PropertyType.RELATED_ONE,
      relationshipType: 'IN_COURSE',
      direction: Direction.OUTGOING,
      fields: ['title', 'status'],
      where: undefined,
      minHops: undefined,
      maxHops: undefined,
      label: undefined,
      expression: undefined,
      targetLabels: ['ProjectionMetaCourse'],
    })
  })

  it('@RelatedMany defaults to BOTH direction and registers field subsets', () => {
    const schema = getModel(ProjectionMetaStudent)

    const completed = propertyState(schema, 'completedLessons')
    expect(completed.type).toBe(PropertyType.RELATED_MANY)
    expect(completed.relationshipType).toBe('COMPLETED_LESSON')
    expect(completed.direction).toBe(Direction.BOTH)
    expect(completed.fields).toEqual(['slug'])

    const cohort = propertyState(schema, 'cohortLessons')
    expect(cohort.direction).toBe(Direction.INCOMING)
    expect(cohort.fields).toEqual(['slug', 'title'])
  })

  it('@RelatedOne / @RelatedMany without fields defer to full-entity eager loading', () => {
    const schema = getModel(ProjectionMetaStudent)

    expect(propertyState(schema, 'fullCourse').fields).toBeUndefined()
    expect(propertyState(schema, 'allLessons').fields).toBeUndefined()
  })

  it('@RelationshipCount registers type, direction, where and hops', () => {
    const schema = getModel(ProjectionMetaStudent)

    expect(propertyState(schema, 'materialCount')).toEqual(
      expect.objectContaining({
        type: PropertyType.RELATIONSHIP_COUNT,
        relationshipType: 'HAS_MODULE|HAS_LESSON',
        direction: Direction.OUTGOING,
      }),
    )

    expect(propertyState(schema, 'requiredLessonsCount')).toEqual(
      expect.objectContaining({
        type: PropertyType.RELATIONSHIP_COUNT,
        where: 'NOT node:OptionalLesson',
        minHops: 1,
        maxHops: 2,
        targetLabels: ['ProjectionMetaLesson'],
      }),
    )

    // Fixed hop count
    expect(propertyState(schema, 'twoHopCount')).toEqual(
      expect.objectContaining({
        minHops: 2,
        maxHops: 2,
      }),
    )
  })

  it('@RelationshipExists registers type, direction and where', () => {
    expect(propertyState(getModel(ProjectionMetaStudent), 'hasNextLesson')).toEqual(
      expect.objectContaining({
        type: PropertyType.RELATIONSHIP_EXISTS,
        relationshipType: 'NEXT_LESSON',
        direction: Direction.OUTGOING,
        where: 'NOT node:OptionalLesson',
      }),
    )
  })

  it('@LabelPresent, @Expression and @Computed register their payloads', () => {
    const schema = getModel(ProjectionMetaStudent)

    expect(propertyState(schema, 'isFlagged').type).toBe(PropertyType.LABEL_PRESENT)
    expect(propertyState(schema, 'isFlagged').label).toBe('Flagged')

    expect(propertyState(schema, 'completedTotal').type).toBe(PropertyType.EXPRESSION)
    expect(propertyState(schema, 'completedTotal').expression).toBe(
      'size((this)-[:COMPLETED_LESSON]->())',
    )

    const summary = schema.getProperty('summary')
    expect(summary.getType()).toBe(PropertyType.COMPUTED)
    expect(typeof summary.getCompute()).toBe('function')
  })
})

describe('projection definitions: decorator / map-schema parity (extends NTS-14)', () => {
  function snapshot(constructor: Newable) {
    const schema = getModel(constructor)

    const projectedProperties = [
      'course',
      'completedLessons',
      'cohortLessons',
      'fullCourse',
      'allLessons',
      'materialCount',
      'requiredLessonsCount',
      'twoHopCount',
      'hasNextLesson',
      'isFlagged',
      'completedTotal',
      'summary',
    ].map((key) => ({ key, ...propertyState(schema, key) }))

    return projectedProperties
  }

  it('map-based definitions produce identical projection schema state', () => {
    defineModel('ProjectionParityCourse', { title: 'string', status: 'string' })
    defineModel('ProjectionParityLesson', { slug: 'string' })

    const Student = defineModel('ProjectionParityStudent', {
      course: {
        type: 'relatedOne',
        relationship: 'IN_COURSE',
        direction: 'out',
        target: 'ProjectionParityCourse',
        fields: ['title', 'status'],
      },
      completedLessons: {
        type: 'relatedMany',
        relationship: 'COMPLETED_LESSON',
        target: 'ProjectionParityLesson',
        fields: ['slug'],
      },
      cohortLessons: {
        type: 'relatedMany',
        relationship: 'COHORT',
        direction: 'in',
        target: 'ProjectionParityLesson',
        fields: ['slug', 'title'],
      },
      fullCourse: {
        type: 'relatedOne',
        relationship: 'IN_COURSE',
        direction: 'out',
        target: 'ProjectionParityCourse',
      },
      allLessons: {
        type: 'relatedMany',
        relationship: 'COMPLETED_LESSON',
        direction: 'out',
        target: 'ProjectionParityLesson',
      },
      materialCount: {
        type: 'relationshipCount',
        relationship: 'HAS_MODULE|HAS_LESSON',
        direction: 'out',
      },
      requiredLessonsCount: {
        type: 'relationshipCount',
        relationship: 'COMPLETED_LESSON',
        direction: 'out',
        target: 'ProjectionParityLesson',
        where: 'NOT node:OptionalLesson',
        minHops: 1,
        maxHops: 2,
      },
      twoHopCount: {
        type: 'relationshipCount',
        relationship: 'CHAIN',
        direction: 'out',
        minHops: 2,
        maxHops: 2,
      },
      hasNextLesson: {
        type: 'relationshipExists',
        relationship: 'NEXT_LESSON',
        direction: 'out',
        where: 'NOT node:OptionalLesson',
      },
      isFlagged: { type: 'labelPresent', label: 'Flagged' },
      completedTotal: { type: 'expression', expression: 'size((this)-[:COMPLETED_LESSON]->())' },
      summary: {
        type: 'computed',
        compute: (entity: Record<string, unknown>) => `${entity.completedTotal} completed`,
      },
    })

    const decoratorState = snapshot(ProjectionMetaStudent).map(({ key, ...rest }) => ({
      key,
      ...rest,
    }))
    const mapState = snapshot(Student)

    // Same keys, same PropertyTypes, same projection payloads; only the
    // target label names differ (fixture vs parity model labels), which
    // the map API resolves by name.
    expect(
      mapState.map(
        ({
          key,
          type,
          relationshipType,
          direction,
          fields,
          where,
          minHops,
          maxHops,
          label,
          expression,
        }) => ({
          key,
          type,
          relationshipType,
          direction,
          fields,
          where,
          minHops,
          maxHops,
          label,
          expression,
        }),
      ),
    ).toEqual(
      decoratorState.map(
        ({
          key,
          type,
          relationshipType,
          direction,
          fields,
          where,
          minHops,
          maxHops,
          label,
          expression,
        }) => ({
          key,
          type,
          relationshipType,
          direction,
          fields,
          where,
          minHops,
          maxHops,
          label,
          expression,
        }),
      ),
    )

    // Targets resolved by name on the map side
    const mapSchema = getModel(Student)
    expect(getModel(mapSchema.getProperty('course').getEntity()).getLabels()).toEqual([
      'ProjectionParityCourse',
    ])
    expect(getModel(mapSchema.getProperty('completedLessons').getEntity()).getLabels()).toEqual([
      'ProjectionParityLesson',
    ])
  })
})
