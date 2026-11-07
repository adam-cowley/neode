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
} from '../../src/decorators'
import { getModel } from '../../src/meta'
import { hasProjectedProperties, projectionNode } from '../../src/projection'
import { Direction } from '../../src/query'

/**
 * Projection Cypher composition (NTS-135/136/137/138): every projected
 * property kind composes into the single RETURN map projection —
 * one query per read, no N+1.
 */

/** Collapse whitespace the same way the eager-utils tests do */
const normalise = (pattern: string): string => pattern.replace(/\n/g, '').replace(/\s\s/g, '')

@NodeEntity()
class ProjectionQueryCourse {
  @Property({ type: 'string' }) title: string
}

@NodeEntity()
class ProjectionQueryLesson {
  @Property({ type: 'string' }) slug: string
}

@NodeEntity()
class ProjectionQueryModel {
  @Property({ type: 'string' }) name: string

  @RelatedOne({ type: 'IN_COURSE', direction: 'out', fields: ['title', 'status'] })
  course: { title: string; status: string }

  @RelatedMany({ type: 'COMPLETED_LESSON', fields: ['slug'] })
  completedLessons: string[]

  @RelatedMany({ type: 'COHORT', direction: 'in', fields: ['slug', 'title'] })
  cohortLessons: { slug: string; title: string }[]

  @RelatedOne({ type: 'ACTED_IN', direction: 'out', target: () => ProjectionQueryCourse })
  fullCourse: ProjectionQueryCourse

  @RelatedMany({ type: 'COMPLETED_LESSON', direction: 'out', target: () => ProjectionQueryLesson })
  allLessons: ProjectionQueryLesson[]

  @RelationshipCount({ type: 'HAS_MODULE|HAS_LESSON', direction: 'out' })
  materialCount: number

  @RelationshipCount({
    type: 'COMPLETED_LESSON',
    direction: 'out',
    target: () => ProjectionQueryLesson,
    where: 'NOT node:OptionalLesson',
    minHops: 1,
    maxHops: 2,
  })
  requiredLessonsCount: number

  @RelationshipCount({ type: 'CHAIN', direction: 'out', minHops: 2, maxHops: 2 })
  fixedHopCount: number

  @RelationshipExists({ type: 'NEXT_LESSON', direction: 'out', where: 'NOT node:OptionalLesson' })
  hasNextLesson: boolean

  @LabelPresent('Flagged')
  isFlagged: boolean

  @Expression('size((this)-[:COMPLETED_LESSON]->())')
  completedTotal: number

  @Computed((entity: ProjectionQueryModel) => `${entity.name} computed`)
  summary: string
}

describe('projection Cypher composition (NTS-135/136/137/138)', () => {
  it('composes every projected kind into one RETURN map projection', () => {
    const query = normalise(projectionNode('this', getModel(ProjectionQueryModel)))

    // Subset @RelatedOne: pattern comprehension with a map projection, first element
    expect(query).toContain(
      'course: [ (this)-[:`IN_COURSE`]->(node) | node { .title, .status } ][0]',
    )

    // @RelatedMany with a single field: scalar array projection
    expect(query).toContain('completedLessons: [ (this)-[:`COMPLETED_LESSON`]-(node) | node.slug ]')

    // @RelatedMany with several fields: array of plain maps
    expect(query).toContain(
      'cohortLessons: [ (this)<-[:`COHORT`]-(node) | node { .slug, .title } ]',
    )

    // @RelationshipCount: inline COUNT { } subquery, multi-type via pipe
    expect(query).toContain('materialCount: COUNT { (this)-[:`HAS_MODULE`|`HAS_LESSON`]->(node) }')

    // ...with WHERE, target labels and variable-length hops
    expect(query).toContain(
      'requiredLessonsCount: COUNT { (this)-[:`COMPLETED_LESSON`*1..2]->(node:`ProjectionQueryLesson`) WHERE NOT node:OptionalLesson }',
    )

    // ...with a fixed hop count
    expect(query).toContain('fixedHopCount: COUNT { (this)-[:`CHAIN`*2]->(node) }')

    // @RelationshipExists: inline EXISTS { } subquery
    expect(query).toContain(
      'hasNextLesson: EXISTS { (this)-[:`NEXT_LESSON`]->(node) WHERE NOT node:OptionalLesson }',
    )

    // @LabelPresent: label predicate
    expect(query).toContain('isFlagged: this:`Flagged`')

    // @Expression: raw Cypher passthrough
    expect(query).toContain('completedTotal: size((this)-[:COMPLETED_LESSON]->())')

    // @Computed: never in Cypher
    expect(query).not.toContain('summary')

    // Identity markers for hydration
    expect(query).toContain('__EAGER_ID__: elementId(this)')
    expect(query).toContain('.*')
  })

  it('full-entity @RelatedOne / @RelatedMany reuse the eager loading patterns', () => {
    const query = normalise(projectionNode('this', getModel(ProjectionQueryModel)))

    // First (singular) element of a full eager pattern
    expect(query).toContain('fullCourse: [ (this)-[this_fullCourse_rel:`ACTED_IN`]->')
    expect(query.match(/fullCourse: \[.*\]\[0\]/)).toBeTruthy()

    // Many form: no [0] suffix on the eager list
    expect(query).toContain('allLessons: [ (this)-[this_allLessons_rel:`COMPLETED_LESSON`]->')
    expect(query.match(/allLessons: \[.*\]\[0\]/)).toBeFalsy()
  })

  it('hasProjectedProperties flags models that need the projection read path', () => {
    expect(hasProjectedProperties(getModel(ProjectionQueryModel))).toBe(true)

    @NodeEntity()
    class Plain {
      @Property({ type: 'string' }) name: string
    }

    expect(hasProjectedProperties(getModel(Plain))).toBe(false)

    // COMPUTED alone still needs the projection path (post-hydration pass)
    @NodeEntity()
    class OnlyComputed {
      @Property({ type: 'string' }) name: string
      @Computed((entity: OnlyComputed) => entity.name) shout: string
    }

    expect(hasProjectedProperties(getModel(OnlyComputed))).toBe(true)
  })

  it('counts and exists without an explicit direction default to BOTH', () => {
    @NodeEntity()
    class DefaultDirection {
      @RelationshipCount({ type: 'R' })
      count: number
      @RelationshipExists({ type: 'R' })
      exists: boolean
    }

    const query = normalise(projectionNode('this', getModel(DefaultDirection)))

    expect(query).toContain('count: COUNT { (this)-[:`R`]-(node) }')
    expect(query).toContain('exists: EXISTS { (this)-[:`R`]-(node) }')
  })

  it('does not emit a WHERE clause when none is configured', () => {
    @NodeEntity()
    class NoWhere {
      @RelationshipCount({ type: 'R', direction: Direction.OUTGOING })
      count: number
    }

    const query = normalise(projectionNode('this', getModel(NoWhere)))

    expect(query).toContain('count: COUNT { (this)-[:`R`]->(node) }')
    expect(query).not.toContain('WHERE')
  })
})
