import {
  NodeEntity,
  Property,
  RelatedMany,
  RelatedOne,
  RelationshipCount,
} from '../../src/decorators'
import { QueryOutput, Runner } from '../../src/driver/types'
import { getModel } from '../../src/meta'
import { ProjectionService } from '../../src/projection/projection.service'

/**
 * Nested filters / sort on projected read-model fields (NTS-145): object
 * filters on @RelatedOne / @RelatedMany keys compile to a traversal MATCH +
 * WHERE in the same single read query; nested sort keys ORDER BY the bound
 * traversal alias.
 */

/** Collapse whitespace the same way the other projection tests do */
const normalise = (pattern: string): string => pattern.replace(/\n/g, '').replace(/\s\s/g, '')

interface CapturedQuery {
  query: string
  params: Record<string, unknown>
}

/** Runner stub that records every compiled query without touching a database */
function captureRunner(captured: CapturedQuery[]): Runner {
  return {
    run: async (query: string, params?: Record<string, unknown>) => {
      captured.push({ query, params: params ?? {} })

      return { records: [] } as unknown as QueryOutput
    },
  }
}

async function compile(params: Record<string, unknown>, order?: unknown): Promise<CapturedQuery> {
  const captured: CapturedQuery[] = []

  await new ProjectionService(captureRunner(captured)).get(
    ProjectionFilterModel,
    getModel(ProjectionFilterModel),
    params,
    undefined,
    undefined,
    order as never,
  )

  expect(captured).toHaveLength(1)

  return captured[0]
}

@NodeEntity()
class ProjectionFilterCourse {
  @Property({ type: 'string' }) title: string
  @Property({ type: 'string' }) slug: string
}

@NodeEntity()
class ProjectionFilterModel {
  @Property({ type: 'string' }) name: string

  @RelatedOne({
    type: 'IN_COURSE',
    direction: 'out',
    fields: ['title'],
    target: () => ProjectionFilterCourse,
  })
  course: { title: string }

  @RelatedOne({ type: 'IN_COURSE', direction: 'out', target: () => ProjectionFilterCourse })
  fullCourse: ProjectionFilterCourse

  @RelatedMany({ type: 'DONE', fields: ['slug'] })
  completedLessons: string[]

  @RelationshipCount({ type: 'DONE', direction: 'out' })
  lessonCount: number
}

describe('projection nested filters / sort (NTS-145)', () => {
  it('compiles an object filter on a @RelatedOne to a traversal MATCH + WHERE', async () => {
    const { query, params } = await compile({ course: { slug: 'intro' } })

    const cypher = normalise(query)

    // Traversal bound in the same single read query — no N+1
    expect(cypher).toContain(
      'MATCH (this)-[this_course_filter_rel:`IN_COURSE`]->(this_course_filter:ProjectionFilterCourse)',
    )
    expect(cypher).toContain('WHERE (this_course_filter.slug = $where_this_course_filter_slug)')
    expect(params.where_this_course_filter_slug).toBe('intro')

    // The RETURN projection is untouched
    expect(cypher).toContain('RETURN this {')
    expect(cypher).toContain(
      'course: [ (this)-[:`IN_COURSE`]->(node:`ProjectionFilterCourse`) | node.title ][0]',
    )
  })

  it('keeps own-property filters working alongside a nested filter', async () => {
    const { query, params } = await compile({ name: 'Adam', course: { title: 'Neo4j Mastery' } })

    const cypher = normalise(query)

    expect(cypher).toContain('WHERE (this.name = $where_this_name)')
    expect(params.where_this_name).toBe('Adam')
    expect(cypher).toContain('WHERE (this_course_filter.title = $where_this_course_filter_title)')
    expect(params.where_this_course_filter_title).toBe('Neo4j Mastery')
  })

  it('nested filter on a full-entity @RelatedOne behaves the same', async () => {
    const { query, params } = await compile({ fullCourse: { slug: 'graph-basics' } })

    const cypher = normalise(query)

    expect(cypher).toContain(
      'MATCH (this)-[this_fullCourse_filter_rel:`IN_COURSE`]->(this_fullCourse_filter:ProjectionFilterCourse)',
    )
    expect(cypher).toContain(
      'WHERE (this_fullCourse_filter.slug = $where_this_fullCourse_filter_slug)',
    )
    expect(params.where_this_fullCourse_filter_slug).toBe('graph-basics')
  })

  it('nested filter on a @RelatedMany matches when one related node matches', async () => {
    const { query } = await compile({ completedLessons: { slug: 'intro' } })

    const cypher = normalise(query)

    expect(cypher).toContain(
      'MATCH (this)-[this_completedLessons_filter_rel:`DONE`]-(this_completedLessons_filter)',
    )
    expect(cypher).toContain(
      'WHERE (this_completedLessons_filter.slug = $where_this_completedLessons_filter_slug)',
    )
  })

  it('ignores unknown keys (GetService parity)', async () => {
    const { query } = await compile({ nope: { slug: 'intro' } })

    expect(normalise(query)).not.toContain('_filter')
  })

  it('throws a clear error for an object filter on a non-related property', async () => {
    await expect(compile({ lessonCount: { minimum: 2 } })).rejects.toThrow(
      /lessonCount.*@RelatedOne.*@RelatedMany/s,
    )
  })

  it('compiles a nested sort to ORDER BY on the traversal alias', async () => {
    const { query } = await compile({}, { course: 'title' })

    const cypher = normalise(query)

    // OPTIONAL MATCH: a sort binds the related node but never filters rows
    expect(cypher).toContain(
      'OPTIONAL MATCH (this)-[this_course_filter_rel:`IN_COURSE`]->(this_course_filter:ProjectionFilterCourse)',
    )
    expect(cypher).toContain('ORDER BY this_course_filter.title')
  })

  it('reuses the filter traversal for a nested sort on the same property', async () => {
    const { query } = await compile({ course: { title: 'Neo4j Mastery' } }, { course: 'title' })

    const cypher = normalise(query)

    // One traversal (the filtering MATCH), no extra OPTIONAL MATCH
    expect(cypher.match(/this_course_filter_rel/g)).toHaveLength(1)
    expect(cypher).not.toContain('OPTIONAL MATCH')
    expect(cypher).toContain('ORDER BY this_course_filter.title')
  })

  it('throws for a nested sort on a @RelatedMany', async () => {
    await expect(compile({}, { completedLessons: 'slug' })).rejects.toThrow(/completedLessons/)
  })

  it('keeps plain own-property ordering untouched', async () => {
    const { query } = await compile({}, { name: 'DESC' })

    expect(normalise(query)).toContain('ORDER BY this.name DESC')
  })
})
