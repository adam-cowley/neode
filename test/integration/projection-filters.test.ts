import { openBackend, TestBackend } from './support/backend'

import {
  InternalId,
  NodeEntity,
  Property,
  RelatedMany,
  RelatedOne,
  RelationshipCount,
} from '../../src/decorators'
import { getModel } from '../../src/meta'
import { ProjectionService } from '../../src/projection/projection.service'

/**
 * End-to-end nested filters / sort on projected read-model fields (NTS-145):
 * `filter: { course: { slug: 'x' } }` traverses to the related node and
 * filters on its properties — still one query per read, projection intact.
 */

@NodeEntity()
class FilterCourse {
  @InternalId() _id: string
  @Property({ type: 'string' }) title: string
  @Property({ type: 'string' }) slug: string
}

@NodeEntity()
class FilterLesson {
  @InternalId() _id: string
  @Property({ type: 'string' }) slug: string
}

@NodeEntity()
class FilterStudent {
  @InternalId() _id: string
  @Property({ type: 'string', primary: true }) id: string
  @Property({ type: 'string' }) name: string

  @RelatedOne({
    type: 'IN_COURSE',
    direction: 'out',
    fields: ['title', 'slug'],
    target: () => FilterCourse,
  })
  course: { title: string; slug: string }

  @RelatedOne({ type: 'IN_COURSE', direction: 'out', target: () => FilterCourse })
  fullCourse: FilterCourse

  @RelatedMany({
    type: 'COMPLETED_LESSON',
    direction: 'out',
    fields: ['slug'],
    target: () => FilterLesson,
  })
  completedLessons: string[]

  @RelationshipCount({ type: 'COMPLETED_LESSON', direction: 'out' })
  completedCount: number
}

describe('projection nested filters / sort end-to-end (NTS-145)', () => {
  let backend: TestBackend
  let projections: ProjectionService

  beforeAll(async () => {
    backend = await openBackend()
    projections = new ProjectionService(backend.connection)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  /**
   * (Adam)-[:IN_COURSE]->(Neo4j Mastery / neo4j-mastery), 2 completed lessons
   * (Billy)-[:IN_COURSE]->(Graph Basics / graph-basics), 1 completed lesson
   */
  async function seed(): Promise<void> {
    await backend.connection.run(
      'CREATE (adam:FilterStudent { id: "adam", name: "Adam" })-[:IN_COURSE]->(a:FilterCourse { title: "Neo4j Mastery", slug: "neo4j-mastery" })\n' +
        'CREATE (adam)-[:COMPLETED_LESSON]->(:FilterLesson { slug: "intro" })\n' +
        'CREATE (adam)-[:COMPLETED_LESSON]->(:FilterLesson { slug: "props" })\n' +
        'CREATE (billy:FilterStudent { id: "billy", name: "Billy" })-[:IN_COURSE]->(b:FilterCourse { title: "Graph Basics", slug: "graph-basics" })\n' +
        'CREATE (billy)-[:COMPLETED_LESSON]->(:FilterLesson { slug: "warmup" })',
    )
  }

  const names = (students: unknown[]): string[] =>
    (students as FilterStudent[]).map((student) => student.name).sort()

  it('filters on a nested @RelatedOne field and keeps the projection intact', async () => {
    await seed()

    const results = await projections.get<FilterStudent>(FilterStudent, getModel(FilterStudent), {
      course: { slug: 'neo4j-mastery' },
    })

    expect(names(results)).toEqual(['Adam'])

    // The read model is still fully projected in the same query
    const adam = (results as FilterStudent[])[0]
    expect(adam.course).toEqual({ title: 'Neo4j Mastery', slug: 'neo4j-mastery' })
    expect(adam.completedCount).toBe(2)
    expect(adam.completedLessons).toEqual(expect.arrayContaining(['intro', 'props']))
  })

  it('filters on a full-entity @RelatedOne field', async () => {
    await seed()

    const results = await projections.get<FilterStudent>(FilterStudent, getModel(FilterStudent), {
      fullCourse: { slug: 'graph-basics' },
    })

    expect(names(results)).toEqual(['Billy'])

    const billy = (results as FilterStudent[])[0]
    expect(billy.fullCourse).toBeInstanceOf(FilterCourse)
    expect(billy.fullCourse.title).toBe('Graph Basics')
  })

  it('filters on a nested @RelatedMany field', async () => {
    await seed()

    const results = await projections.get<FilterStudent>(FilterStudent, getModel(FilterStudent), {
      completedLessons: { slug: 'warmup' },
    })

    expect(names(results)).toEqual(['Billy'])
  })

  it('combines own-property and nested filters, including no-match', async () => {
    await seed()

    const both = await projections.get<FilterStudent>(FilterStudent, getModel(FilterStudent), {
      name: 'Adam',
      course: { slug: 'neo4j-mastery' },
    })

    expect(names(both)).toEqual(['Adam'])

    const none = await projections.get<FilterStudent>(FilterStudent, getModel(FilterStudent), {
      name: 'Billy',
      course: { slug: 'neo4j-mastery' },
    })

    expect(none).toEqual([])
  })

  it('sorts by a nested @RelatedOne field', async () => {
    await seed()

    const results = await projections.get<FilterStudent>(
      FilterStudent,
      getModel(FilterStudent),
      {},
      undefined,
      undefined,
      { course: 'title' },
    )

    expect((results as FilterStudent[]).map((student) => student.name)).toEqual(['Billy', 'Adam'])
  })

  it('surfaces nested filters and sort through the neode facade', async () => {
    await seed()

    // neode.get routes through ProjectionService (hasProjectedProperties)
    const filtered = await backend.neode.get<FilterStudent>(FilterStudent, {
      course: { title: 'Neo4j Mastery' },
    })

    expect(names(filtered)).toEqual(['Adam'])

    // neode.all carries the order spec through to the projection read
    const sorted = await backend.neode.all<FilterStudent>(FilterStudent, {}, { course: 'slug' })

    expect((sorted as FilterStudent[]).map((student) => student.name)).toEqual(['Billy', 'Adam'])
  })

  it('throws a clear error for an object filter on a non-related property', async () => {
    await seed()

    await expect(
      projections.get<FilterStudent>(FilterStudent, getModel(FilterStudent), {
        completedCount: { minimum: 2 },
      }),
    ).rejects.toThrow(/completedCount/)
  })
})
