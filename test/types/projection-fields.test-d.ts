/**
Type-level tests for @RelatedOne / @RelatedMany `fields` checking:
run with `pnpm test:types` (vitest typecheck mode).
*/
import { describe, expectTypeOf, it } from 'vitest'
import { NodeEntity, Property, RelatedMany, RelatedOne } from '../../src/decorators/index.js'

@NodeEntity()
class Course {
  @Property({ type: 'string' })
  title!: string

  @Property({ type: 'string' })
  status!: string
}

// Compile-time negatives, pre-built so the error anchors at the decorator
// application (fresh literals anchor overload errors per property, which a
// suppression comment cannot chase across an overload set)
const badFields = {
  type: 'IN_COURSE',
  direction: 'out' as const,
  target: () => Course,
  fields: ['nosuch'],
}

const badPathFields = {
  path: [{ type: 'NEXT_COURSE', direction: 'out' as const }],
  target: () => Course,
  fields: ['nosuch'],
}

@NodeEntity()
class Learner {
  // checked overload: fields must be keys of the target
  @RelatedOne({
    type: 'IN_COURSE',
    direction: 'out',
    target: () => Course,
    fields: ['title', 'status'],
  })
  course?: Pick<Course, 'title' | 'status'>

  @RelatedMany({
    type: 'NEXT_COURSE',
    direction: 'out',
    target: () => Course,
    fields: ['title'],
  })
  nextCourses?: Pick<Course, 'title'>[]

  // @ts-expect-error 'nosuch' is not a field of Course
  @RelatedOne(badFields)
  badCourse?: unknown

  // @ts-expect-error 'nosuch' is not a field of Course
  @RelatedMany(badFields)
  badCourses?: unknown

  // NTS-547 — path form: checked against the final hop's target too
  @RelatedMany({
    path: [
      { type: 'NEXT_COURSE', direction: 'out' },
      { type: 'IN_COURSE', direction: 'in' },
    ],
    target: () => Course,
    fields: ['title'],
  })
  siblingCourses?: Pick<Course, 'title'>[]

  // @ts-expect-error 'nosuch' is not a field of Course
  @RelatedMany(badPathFields)
  badPathCourses?: unknown

  // unchecked overload: fields without a target stays legal
  @RelatedMany({ type: 'COMPLETED_LESSON', fields: ['slug'] })
  completedSlugs?: string[]

  // unchecked path overload: fields without a target stays legal
  @RelatedMany({
    path: [{ type: 'COMPLETED_LESSON', direction: 'out' }],
    fields: ['slug'],
  })
  pathSlugs?: string[]
}

// Compile-time negative only — deliberately not registered: @NodeEntity
// would replay the registration and the decorator's runtime check throws.
class Orphan {
  // @ts-expect-error neither fields nor target
  @RelatedOne({ type: 'IN_COURSE', direction: 'out' })
  noShape?: unknown
}

describe('@RelatedOne / @RelatedMany fields checking', () => {
  it('accepts fields that exist on the target', () => {
    expectTypeOf<Learner['course']>().toEqualTypeOf<Pick<Course, 'title' | 'status'> | undefined>()
    expectTypeOf<Learner['nextCourses']>().toEqualTypeOf<Pick<Course, 'title'>[] | undefined>()
    expectTypeOf<Learner['siblingCourses']>().toEqualTypeOf<Pick<Course, 'title'>[] | undefined>()
    expectTypeOf<Orphan['noShape']>().toEqualTypeOf<unknown>()
  })
})
