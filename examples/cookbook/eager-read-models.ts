/**
Cookbook — eager loading depths and declarative read models.

Two ways to get graph data onto a read without N+1 queries:
1. eager relationships (@OneToMany's last argument `true`) hydrate
   recursively — Student → Course → Lesson hydrates to every depth the
   chain declares;
2. @RelatedOne / @RelatedMany / @RelationshipCount project a read-only
   view (field subsets, counts) in the SAME query as the node itself.

Projections pass `target()` so `fields` is type-checked against the
target's properties, and annotate with `Pick<Target, …>` so the DTO
shape and the `fields` list cannot drift apart.

The projections read the same relationship TYPES the write-model
properties declare — relate() resolves keys on the write model, the
projections are read-only views over them.

Run:  npx tsx examples/cookbook/eager-read-models.ts
*/
import {
  Direction,
  NodeEntity,
  OneToMany,
  Property,
  RelatedMany,
  RelatedOne,
  RelationshipCount,
  Uuid,
  fromEnv,
} from 'neode'

@NodeEntity()
class Lesson {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  slug!: string
}

@NodeEntity()
class Course {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  title!: string

  @Property({ type: 'string' })
  status!: string

  // Eager — hydrated whenever a Course is read, whatever the entry point
  @OneToMany(() => Lesson, 'HAS_LESSON', Direction.OUTGOING, true)
  lessons!: Lesson[]
}

@NodeEntity()
class Student {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string

  // Write model: depth-2 eager chain — Student → courses → each course's
  // lessons — and the key relate() resolves for enrolments and completions
  @OneToMany(() => Course, 'IN_COURSE', Direction.OUTGOING, true)
  courses!: Course[]

  @OneToMany(() => Lesson, 'COMPLETED_LESSON', Direction.OUTGOING)
  completed!: Lesson[]

  // Read model over the same relationship types, one query per read.
  // Recommended form: target() checks `fields` against the target, and a
  // Pick annotation keeps the DTO shape from drifting. Two fields → a
  // plain DTO; a single field would project the scalar.
  @RelatedOne({
    type: 'IN_COURSE',
    direction: 'out',
    target: () => Course,
    fields: ['title', 'status'],
  })
  course!: Pick<Course, 'title' | 'status'>

  @RelatedMany({ type: 'COMPLETED_LESSON', target: () => Lesson, fields: ['slug'] })
  completedSlugs!: string[]

  @RelationshipCount({ type: 'COMPLETED_LESSON', direction: 'out' })
  completedCount!: number
}

async function main(): Promise<void> {
  const neode = fromEnv()

  try {
    const course = await neode.create(Course, { title: 'Neo4j 101', status: 'ACTIVE' })
    const [intro, indexes] = await Promise.all([
      neode.create(Lesson, { slug: 'intro' }),
      neode.create(Lesson, { slug: 'indexes' }),
    ])
    const adam = await neode.create(Student, { name: 'Adam' })

    await neode.relate(Course, course, intro, 'lessons')
    await neode.relate(Course, course, indexes, 'lessons')
    await neode.relate(Student, adam, course, 'courses')
    await neode.relate(Student, adam, intro, 'completed')

    // One read — eager chain and projections arrive hydrated together
    const student = await neode.find(Student, adam.id)
    console.log(student?.courses[0]?.lessons.map((lesson) => lesson.slug)) // depth-2
    console.log(student?.course, student?.completedSlugs, student?.completedCount)

    await Promise.all([
      neode.delete(adam),
      neode.delete(course),
      neode.delete(intro),
      neode.delete(indexes),
    ])
  } finally {
    await neode.close()
  }
}

main().catch(console.error)
