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
import { ProjectionService } from '../../src/projection/projection.service'
import { toJson } from '../../src/serialise'
import { openBackend, TestBackend } from './support/backend'

/**
 * End-to-end projection reads (NTS-135/136/137/138): the whole read model
 * is fetched in ONE query — related subsets, counts, exists, labels,
 * expressions and computed fields alike.
 */

@NodeEntity()
class ProjectionCourse {
  @InternalId() _id: string
  @Property({ type: 'string' }) title: string
  @Property({ type: 'string' }) status: string
}

@NodeEntity()
class ProjectionLesson {
  @InternalId() _id: string
  @Property({ type: 'string' }) slug: string
}

@NodeEntity()
class StudentProgress {
  @InternalId() _id: string
  @Property({ type: 'string', primary: true }) id: string
  @Property({ type: 'string' }) name: string

  @RelatedOne({
    type: 'IN_COURSE',
    direction: 'out',
    fields: ['title', 'status'],
    target: () => ProjectionCourse,
  })
  course: { title: string; status: string }

  @RelatedMany({ type: 'COMPLETED_LESSON', fields: ['slug'] })
  completedLessons: string[]

  @RelatedOne({ type: 'IN_COURSE', direction: 'out', target: () => ProjectionCourse })
  fullCourse: ProjectionCourse

  @RelatedMany({ type: 'COMPLETED_LESSON', direction: 'out', target: () => ProjectionLesson })
  allLessons: ProjectionLesson[]

  @RelationshipCount({ type: 'HAS_MODULE|HAS_LESSON', direction: 'out' })
  materialCount: number

  @RelationshipCount({
    type: 'COMPLETED_LESSON',
    direction: 'out',
    where: 'NOT node:OptionalLesson',
  })
  requiredLessonsCount: number

  @RelationshipCount({ type: 'CHAIN', direction: 'out', minHops: 2, maxHops: 2 })
  twoHopCount: number

  @RelationshipExists({ type: 'NEXT_LESSON', direction: 'out' })
  hasNextLesson: boolean

  @LabelPresent('Flagged')
  isFlagged: boolean

  // Escape hatch: raw Cypher projected verbatim. COUNT { } rather than
  // size(pattern) — Relate rejects pattern expressions in projections
  @Expression('COUNT { (this)-[:COMPLETED_LESSON]->() }')
  completedTotal: number

  @Computed(
    (entity: StudentProgress) => `${entity.name}: ${(entity.completedLessons || []).length} done`,
  )
  summary: string
}

describe('projection reads (NTS-135/136/137/138)', () => {
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
   * Graph:
   *   (Adam:StudentProgress:Flagged)-[:IN_COURSE]->(:ProjectionCourse)
   *   (Adam)-[:COMPLETED_LESSON]->(:ProjectionLesson {slug}) x2 (one :OptionalLesson)
   *   (Adam)-[:HAS_MODULE]->(:ProjectionModule), (Adam)-[:HAS_LESSON]->(:ProjectionLesson)
   *   (Adam)-[:CHAIN]->(x)-[:CHAIN]->(y)  (two hops)
   *   (Billy:StudentProgress)-[:IN_COURSE]->(...) — no completed lessons, no flags
   */
  async function seed(): Promise<void> {
    await backend.connection.run(
      'CREATE (adam:StudentProgress:Flagged { id: "adam", name: "Adam" })-[:IN_COURSE]->(course:ProjectionCourse { title: "Neo4j Mastery", status: "ACTIVE" })\n' +
        'CREATE (adam)-[:COMPLETED_LESSON]->(intro:ProjectionLesson { slug: "intro" })\n' +
        'CREATE (adam)-[:COMPLETED_LESSON]->(props:ProjectionLesson:OptionalLesson { slug: "props" })\n' +
        'CREATE (adam)-[:HAS_MODULE]->(:ProjectionModule { name: "Basics" })\n' +
        'CREATE (adam)-[:HAS_LESSON]->(intro)\n' +
        'CREATE (adam)-[:NEXT_LESSON]->(props)\n' +
        'CREATE (mid:ProjectionModule { name: "Midpoint" })\n' +
        'CREATE (adam)-[:CHAIN]->(mid)\n' +
        'CREATE (mid)-[:CHAIN]->(:ProjectionModule { name: "End" })\n' +
        'CREATE (billy:StudentProgress { id: "billy", name: "Billy" })-[:IN_COURSE]->(course2:ProjectionCourse { title: "Graph Basics", status: "TRIAL" })\n' +
        'CREATE (billy)-[:HAS_LESSON]->(:ProjectionLesson { slug: "warmup" })',
    )
  }

  it('hydrates the full read model for one student in one query', async () => {
    await seed()

    const queries: string[] = []
    const runner = {
      run: async (query: string, params?: Record<string, unknown>) => {
        queries.push(query)

        return backend.connection.run(query, params, 'READ')
      },
    }

    const adam = (await new ProjectionService(runner).find(
      StudentProgress,
      getModel(StudentProgress),
      'adam',
    )) as unknown as Record<string, unknown>

    // One query per read — no N+1
    expect(queries).toHaveLength(1)

    expect(adam).toBeTruthy()

    // @RelatedOne subset: plain DTO
    expect(adam.course).toEqual({ title: 'Neo4j Mastery', status: 'ACTIVE' })
    expect(Object.getPrototypeOf(adam.course)).toBe(Object.prototype)

    // @RelatedMany subset: scalar array (traversal order is not guaranteed)
    expect(adam.completedLessons).toEqual(expect.arrayContaining(['intro', 'props']))
    expect(adam.completedLessons).toHaveLength(2)

    // Full-entity projections hydrate as entities
    expect(adam.fullCourse).toBeInstanceOf(ProjectionCourse)
    expect((adam.allLessons as unknown[])[0]).toBeInstanceOf(ProjectionLesson)

    // @RelationshipCount: multi-type, WHERE, fixed hops
    expect(adam.materialCount).toBe(2)
    expect(adam.requiredLessonsCount).toBe(1)
    expect(adam.twoHopCount).toBe(1)

    // @RelationshipExists / @LabelPresent / @Expression
    expect(adam.hasNextLesson).toBe(true)
    expect(adam.isFlagged).toBe(true)
    expect(adam.completedTotal).toBe(2)

    // @Computed, after hydration
    expect(adam.summary).toBe('Adam: 2 done')
  })

  it('returns read-model values for every matching node', async () => {
    await seed()

    const results = await projections.get(
      StudentProgress,
      getModel(StudentProgress),
      {},
      undefined,
      undefined,
    )

    expect(results).toHaveLength(2)

    const byName = new Map(
      (results as unknown as Record<string, unknown>[]).map((row) => [row.name, row]),
    )

    const adam = byName.get('Adam') as Record<string, unknown>
    const billy = byName.get('Billy') as Record<string, unknown>

    expect(adam.isFlagged).toBe(true)
    expect(billy.isFlagged).toBe(false)

    // Billy completed nothing: empty list, count 0, exists false
    expect(billy.completedLessons).toEqual([])
    expect(billy.requiredLessonsCount).toBe(0)
    expect(billy.hasNextLesson).toBe(false)
    expect(billy.summary).toBe('Billy: 0 done')

    // Unrelated nodes in the graph are not counted
    expect(adam.materialCount).toBe(2)
    expect(billy.materialCount).toBe(1)

    // Billy's @RelatedOne hydrates as a plain DTO too
    expect(billy.course).toEqual({ title: 'Graph Basics', status: 'TRIAL' })
  })

  it('serialises the read model with toJson', async () => {
    await seed()

    const adam = await projections.find(StudentProgress, getModel(StudentProgress), 'adam')

    const json = toJson(adam as object)

    expect(json).toMatchObject({
      name: 'Adam',
      course: { title: 'Neo4j Mastery', status: 'ACTIVE' },
      completedLessons: expect.arrayContaining(['intro', 'props']),
      materialCount: 2,
      requiredLessonsCount: 1,
      twoHopCount: 1,
      hasNextLesson: true,
      isFlagged: true,
      completedTotal: 2,
      summary: 'Adam: 2 done',
    })

    // Full-entity eager projections serialise recursively
    expect(json.fullCourse).toMatchObject({ title: 'Neo4j Mastery' })
  })
})
