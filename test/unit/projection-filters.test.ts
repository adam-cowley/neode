import {
  NodeEntity,
  Property,
  RelatedMany,
  RelatedOne,
  RelationshipCount,
} from '../../src/decorators'
import { QueryOutput, Runner } from '../../src/driver/types'
import { Builder } from '../../src/query'
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
      'WHERE (EXISTS { WITH this MATCH (this)-[this_course_filter_rel:`IN_COURSE`]->(this_course_filter:ProjectionFilterCourse)',
    )
    expect(cypher).toContain(
      'WHERE (this_course_filter.slug = $sub0_where_this_course_filter_slug)',
    )
    expect(params.sub0_where_this_course_filter_slug).toBe('intro')

    // The RETURN projection is untouched
    expect(cypher).toContain('RETURN this {')
    expect(cypher).toContain(
      'course: [ (this)-[:`IN_COURSE`]->(node:`ProjectionFilterCourse`) | node.title ][0]',
    )
  })

  it('keeps own-property filters working alongside a nested filter', async () => {
    const { query, params } = await compile({ name: 'Adam', course: { title: 'Neo4j Mastery' } })

    const cypher = normalise(query)

    expect(cypher).toContain('this.name = $where_this_name')
    expect(params.where_this_name).toBe('Adam')
    expect(cypher).toContain('this_course_filter.title = $sub0_where_this_course_filter_title')
    expect(params.sub0_where_this_course_filter_title).toBe('Neo4j Mastery')
  })

  it('nested filter on a full-entity @RelatedOne behaves the same', async () => {
    const { query, params } = await compile({ fullCourse: { slug: 'graph-basics' } })

    const cypher = normalise(query)

    expect(cypher).toContain(
      'EXISTS { WITH this MATCH (this)-[this_fullCourse_filter_rel:`IN_COURSE`]->(this_fullCourse_filter:ProjectionFilterCourse)',
    )
    expect(cypher).toContain(
      'WHERE (this_fullCourse_filter.slug = $sub0_where_this_fullCourse_filter_slug)',
    )
    expect(params.sub0_where_this_fullCourse_filter_slug).toBe('graph-basics')
  })

  it('nested filter on a @RelatedMany matches when one related node matches', async () => {
    const { query } = await compile({ completedLessons: { slug: 'intro' } })

    const cypher = normalise(query)

    // EXISTS wrap: several matching related nodes never duplicate the root row (NTS-574)
    expect(cypher).toContain(
      'EXISTS { WITH this MATCH (this)-[this_completedLessons_filter_rel:`DONE`]-(this_completedLessons_filter)',
    )
    expect(cypher).toContain(
      'WHERE (this_completedLessons_filter.slug = $sub0_where_this_completedLessons_filter_slug)',
    )
  })

  it('ignores unknown keys (GetService parity)', async () => {
    const { query } = await compile({ nope: { slug: 'intro' } })

    expect(normalise(query)).not.toContain('_filter')
  })

  it('treats an object filter on a non-related property as an operator object (NTS-646)', async () => {
    // was: a nested-filter rejection — operator objects are the NTS-646 tier
    const { query, params } = await compile({ lessonCount: { gte: 2 } })

    const cypher = normalise(query)

    expect(cypher).toContain('WHERE (this.lessonCount >= $where_this_lessonCount)')
    expect(params['where_this_lessonCount']).toBe(2)
  })

  it('throws a clear error for an unknown operator key (NTS-646)', async () => {
    await expect(compile({ lessonCount: { minimum: 2 } })).rejects.toThrow(
      /Unknown where-filter operator "minimum" on property "lessonCount"/s,
    )
  })

  it('compiles a nested sort to a WITH-carried COLLECT { } subquery', async () => {
    const { query } = await compile({}, { course: 'title' })

    // The sub body's clauses join with newlines — compare whitespace-free
    const cypher = query.replace(/\s+/g, ' ')

    // Doctrine shape (NTS-565): the traversal rides a COLLECT { } subquery
    // carried by the WITH clause; the ORDER BY sorts on the collected
    // list's head — no OPTIONAL MATCH, no row drops or multiplication
    expect(cypher).not.toContain('OPTIONAL MATCH')
    expect(cypher).toContain(
      'WITH this, COLLECT { WITH this MATCH (this)-[this_course_filter_rel:`IN_COURSE`]->(this_course_filter:ProjectionFilterCourse) RETURN this_course_filter.title ORDER BY this_course_filter.title } AS this_course_filter',
    )
    expect(cypher).toContain('ORDER BY this_course_filter[0]')
  })

  it('sorts through its own COLLECT subquery next to a nested filter on the same property', async () => {
    const { query } = await compile({ course: { title: 'Neo4j Mastery' } }, { course: 'title' })

    const cypher = normalise(query)

    // The filter rides an EXISTS subquery (NTS-574) and binds nothing
    // outward, so the sort carries its own COLLECT subquery
    expect(cypher).toContain('EXISTS {')
    expect(cypher).toContain('COLLECT {')
    expect(cypher).not.toContain('OPTIONAL MATCH')
    expect(cypher).toContain('ORDER BY this_course_filter[0]')
  })

  it('throws for a nested sort on a @RelatedMany', async () => {
    await expect(compile({}, { completedLessons: 'slug' })).rejects.toThrow(/completedLessons/)
  })

  it('keeps plain own-property ordering untouched', async () => {
    const { query } = await compile({}, { name: 'DESC' })

    expect(normalise(query)).toContain('ORDER BY this.name DESC')
  })
})

describe('no OPTIONAL MATCH from library-emitted relation reads (NTS-565)', () => {
  /**
  The house Cypher doctrine: library-internal emitters never use
  OPTIONAL MATCH for relation reads — pattern comprehensions for
  unordered relations, COLLECT { } subqueries when the nested read
  carries WHERE / ORDER BY. The Builder's optionalMatch() stays exported
  for raw-Cypher callers; this guard keeps the library honest.
  */
  async function compileWith(
    params: Record<string, unknown>,
    order?: unknown,
  ): Promise<CapturedQuery> {
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

  it('emits no OPTIONAL MATCH for an eager projection read', async () => {
    const { query } = await compileWith({})

    expect(normalise(query)).not.toContain('OPTIONAL MATCH')
  })

  it('emits no OPTIONAL MATCH with a nested filter and sort combined', async () => {
    const { query } = await compileWith({ course: { slug: 'intro' } }, { fullCourse: 'title' })

    const cypher = query.replace(/\s+/g, ' ')

    expect(cypher).not.toContain('OPTIONAL MATCH')
    // The sorted nested read (a different key than the filtered one) rides
    // the WITH-carried COLLECT { } subquery
    expect(cypher).toContain('WITH this, COLLECT { WITH this')
    expect(cypher).toContain('ORDER BY this_fullCourse_filter[0]')
  })

  it('the Builder keeps optionalMatch() for raw-Cypher callers', () => {
    const { query } = new Builder()
      .match('n', ['Node'])
      .optionalMatch('n')
      .relationship('REL', 'out', 'r')
      .to('m', ['Other'])
      .build()

    expect(query).toContain('OPTIONAL MATCH')
  })
})
