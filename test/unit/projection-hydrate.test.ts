import {
  Computed,
  Expression,
  LabelPresent,
  NodeEntity,
  Property,
  RelatedMany,
  RelatedOne,
  RelationshipCount,
  RelationshipExists,
  InternalId,
} from '../../src/decorators'
import { getModel } from '../../src/meta'
import { hydrateProjection } from '../../src/projection'

/**
 * Projection hydration (NTS-135/136/137/138): field subsets become plain
 * JSON-serialisable read-only DTOs (no entity-methods prototype), counts and
 * exists become numbers/booleans, and @Computed derives from the hydrated
 * entity after hydration.
 */

@NodeEntity()
class ProjectionHydrateCourse {
  @InternalId() _id: string
  @Property({ type: 'string' }) title: string
  @Property({ type: 'string' }) status: string
  @Property({ type: 'string' }) secret: string
}

@NodeEntity()
class ProjectionHydrateLesson {
  @InternalId() _id: string
  @Property({ type: 'string' }) slug: string
}

@NodeEntity()
class ProjectionHydrateStudent {
  @InternalId() _id: string
  @Property({ type: 'string' }) name: string

  @RelatedOne({ type: 'IN_COURSE', direction: 'out', fields: ['title', 'status'] })
  course: { title: string; status: string }

  @RelatedMany({ type: 'COMPLETED_LESSON', fields: ['slug'] })
  completedLessons: string[]

  @RelatedOne({ type: 'IN_COURSE', direction: 'out', target: () => ProjectionHydrateCourse })
  fullCourse: ProjectionHydrateCourse

  @RelatedMany({
    type: 'COMPLETED_LESSON',
    direction: 'out',
    target: () => ProjectionHydrateLesson,
  })
  allLessons: ProjectionHydrateLesson[]

  @RelationshipCount({ type: 'HAS_MODULE|HAS_LESSON', direction: 'out' })
  materialCount: number

  @RelationshipExists({ type: 'NEXT_LESSON', direction: 'out' })
  hasNextLesson: boolean

  @LabelPresent('Flagged')
  isFlagged: boolean

  @Expression('size((this)-[:COMPLETED_LESSON]->())')
  completedTotal: number

  @Computed(
    (entity: ProjectionHydrateStudent) =>
      `${entity.name}: ${(entity.completedLessons || []).length}`,
  )
  summary: string
}

/** A RETURN projection row for ProjectionHydrateStudent, as Relate would hand it over */
function studentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    __EAGER_ID__: '4:abc:0',
    __EAGER_LABELS__: ['ProjectionHydrateStudent'],
    name: 'Adam',
    course: { title: 'The Matrix', status: 'ACTIVE' },
    completedLessons: ['intro', 'props'],
    fullCourse: {
      __EAGER_ID__: '4:abc:1',
      __EAGER_LABELS__: ['ProjectionHydrateCourse'],
      title: 'The Matrix',
      status: 'ACTIVE',
      secret: 'hidden in plain sight',
    },
    allLessons: [
      { __EAGER_ID__: '4:abc:2', __EAGER_LABELS__: ['ProjectionHydrateLesson'], slug: 'intro' },
      { __EAGER_ID__: '4:abc:3', __EAGER_LABELS__: ['ProjectionHydrateLesson'], slug: 'props' },
    ],
    materialCount: 3,
    hasNextLesson: true,
    isFlagged: false,
    completedTotal: 2,
    ...overrides,
  }
}

describe('projection hydration (NTS-135/136/137/138)', () => {
  it('hydrates a field subset as a plain read-only DTO (no entity prototype)', () => {
    const schema = getModel(ProjectionHydrateStudent)
    const entity = hydrateProjection<ProjectionHydrateStudent>(
      schema,
      ProjectionHydrateStudent,
      studentRow(),
    )

    expect(entity.course).toEqual({ title: 'The Matrix', status: 'ACTIVE' })

    // Plain object: no entity-methods prototype, JSON-serialisable
    expect(Object.getPrototypeOf(entity.course)).toBe(Object.prototype)
    expect((entity.course as Record<string, unknown>).save).toBeUndefined()
    expect(JSON.parse(JSON.stringify(entity.course))).toEqual(entity.course)

    // Subset only: unrequested fields stay out of the DTO
    expect(entity.course).not.toHaveProperty('secret')
  })

  it('hydrates a single-field @RelatedMany as a scalar array', () => {
    const schema = getModel(ProjectionHydrateStudent)
    const entity = hydrateProjection<ProjectionHydrateStudent>(
      schema,
      ProjectionHydrateStudent,
      studentRow(),
    )

    expect(entity.completedLessons).toEqual(['intro', 'props'])
  })

  it('hydrates full-entity @RelatedOne / @RelatedMany as entities', () => {
    const schema = getModel(ProjectionHydrateStudent)
    const entity = hydrateProjection<ProjectionHydrateStudent>(
      schema,
      ProjectionHydrateStudent,
      studentRow(),
    )

    expect(entity.fullCourse).toBeInstanceOf(ProjectionHydrateCourse)
    expect(entity.fullCourse.title).toBe('The Matrix')
    expect(entity.fullCourse._id).toBe('4:abc:1')

    expect(entity.allLessons).toHaveLength(2)
    expect(entity.allLessons[0]).toBeInstanceOf(ProjectionHydrateLesson)
    expect(entity.allLessons[1].slug).toBe('props')
  })

  it('hydrates counts, exists and label predicates as primitives', () => {
    const schema = getModel(ProjectionHydrateStudent)
    const entity = hydrateProjection<ProjectionHydrateStudent>(
      schema,
      ProjectionHydrateStudent,
      studentRow(),
    )

    expect(entity.materialCount).toBe(3)
    expect(entity.hasNextLesson).toBe(true)
    expect(entity.isFlagged).toBe(false)
    expect(entity.completedTotal).toBe(2)
  })

  it('computes @Computed fields after hydration, from the hydrated entity', () => {
    const schema = getModel(ProjectionHydrateStudent)
    const entity = hydrateProjection<ProjectionHydrateStudent>(
      schema,
      ProjectionHydrateStudent,
      studentRow(),
    )

    expect(entity.summary).toBe('Adam: 2')
  })

  it('leaves absent optional projections unset', () => {
    const schema = getModel(ProjectionHydrateStudent)
    const entity = hydrateProjection<ProjectionHydrateStudent>(
      schema,
      ProjectionHydrateStudent,
      studentRow({ course: null, fullCourse: null, allLessons: [], completedLessons: [] }),
    )

    expect(entity.course).toBeNull()
    expect(entity.fullCourse).toBeNull()
    expect(entity.allLessons).toEqual([])
    expect(entity.completedLessons).toEqual([])
    expect(entity.summary).toBe('Adam: 0')
  })
})
