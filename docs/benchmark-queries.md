# GraphAcademy — Cypher benchmark pack

Raw Cypher extracted from the GraphAcademy codebase (from the query-inventory analysis of `packages/domain/src/**/Neo4j*Repository.ts` and `packages/sync/src/sync.ts`, RETURN projections >15 lines trimmed with `/* … */`). Purpose: benchmark each hand-written query against its neode-ogm twin — 12 reads, 8 writes.

Conventions per query: **params** lists the `:param` names, **stresses** what it exercises, **neode** names the API that generates/executes the same shape.

---

## 1. Setup

### Constraints & indexes (trimmed from `cypher/constraints.cypher` to what this pack touches)

```cypher
// Uniqueness (point lookups + MERGE keys)
CREATE CONSTRAINT IF NOT EXISTS FOR (u:User) REQUIRE u.sub IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (c:Course) REQUIRE c.slug IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (c:Course) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (m:Module) REQUIRE m.link IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (l:Lesson) REQUIRE l.link IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (q:Question) REQUIRE q.id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (a:Answer) REQUIRE a.id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (e:Enrolment) REQUIRE e.id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (e:Enrolment) REQUIRE e.certificateId IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (t:Team) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (a:Attempt) REQUIRE a.id IS UNIQUE;
// Guards the legacy `ref`-became-a-list bug (enrol upsert writes e.ref)
CREATE CONSTRAINT enrolment_ref_is_string IF NOT EXISTS FOR (e:Enrolment) REQUIRE e.ref IS :: STRING;

// Range indexes on hot filter/sort properties
CREATE INDEX IF NOT EXISTS FOR (c:Course) ON (c.status);
CREATE INDEX course_visibility IF NOT EXISTS FOR (c:Course) ON (c.visibility);
CREATE INDEX IF NOT EXISTS FOR (n:Enrolment) ON (n.createdAt);
CREATE INDEX IF NOT EXISTS FOR (n:Enrolment) ON (n.lastSeenAt);
CREATE INDEX IF NOT EXISTS FOR (n:Enrolment) ON (n.reminderSentAt);
CREATE INDEX IF NOT EXISTS FOR (u:User) ON (u.email);

// Full-text
CREATE FULLTEXT INDEX courseSearch IF NOT EXISTS
FOR (c:Course) ON EACH [c.title, c.overview];
```

### Seeding volume (rough targets)

| Node / rel                     | Rows                | Notes                                                                                                                                          |
| ------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`                         | ~100k               | ~10% paired with a `LINKED_TO` edge (identity traversal)                                                                                       |
| `Enrolment`                    | ~1M                 | ~30% carry `CompletedEnrolment`; `lastSeenAt`/`reminderSentAt` spread over 90 days                                                             |
| `Course` / `Module` / `Lesson` | ~300 / ~1.5k / ~10k | plus ~10k `Question` + ~40k `Answer`                                                                                                           |
| `COMPLETED_LESSON`             | ~5M                 | the fan-out that dominates the progress COUNTs                                                                                                 |
| `HAS_MODULE` / `HAS_LESSON`    | ~1.5k / ~10k        | content tree for `HAS_MODULE\|HAS_LESSON*2`                                                                                                    |
| `Movie`/`Person` sandbox       | ~170 / ~1k rels     | Movies-style lesson graph — only needed if you add the teaching-material queries; seed with the shape of `packages/instance`'s `movies` seeder |

Seed through the bulk path (matches what neode's `createMany`/`mergeMany` emit — one `UNWIND` per batch):

```cypher
UNWIND $rows AS row
MERGE (u:User {sub: row.sub})
  ON CREATE SET u.id = row.id, u.createdAt = datetime(), u.email = row.email;
```

Generate `COMPLETED_LESSON` edges with a percentage filter so progress distributions are realistic (`rand() < 0.4`). Runs in `CALL { … } IN TRANSACTIONS OF 10000 ROWS` batches at these volumes.

### Setting params

```text
# Neo4j Browser / cypher-shell (session-scoped, persists until reset):
:param sub => 'auth0|abc123'
:param courseSlug => 'cypher-fundamentals'

# older cypher-shell positional form:
:param sub 'auth0|abc123'
```

Every query below references only `$named` params — set them with `:param` once, then `PROFILE` the statement.

---

## 2. Read benchmarks

### R1 · user-by-sub — single-node primary-key lookup

```cypher
MATCH (u:User {sub: $sub})
RETURN u { /* USER_FIELDS: ~17 fields — label checks (PlatformAdmin/Staff/HiddenProfile),
             country: [(u)-[:FROM_COUNTRY]->(c:Country) | c.code][0], timestamps */ } AS u
```

```text
// params: $sub = 'auth0|abc123'
```

Stresses: the baseline — unique-index point read through a map projection; the latency floor every other read is compared against.

**neode:** `neode.getRepository(User).findBy({ sub })` (first match) or `neode.getFirst(User, { sub })`.

### R2 · course-detail — deep nested pattern-comprehension projection

```cypher
MATCH (c:Course {slug: $slug})
RETURN c {
  .slug, .title, .shortTitle, .description, .thumbnail, .video, .overview, .status,
  .duration, .language, .visibility, .redirect, .replacementDate, .keyPoints, .about,
  instance: CASE WHEN coalesce(c.instanceUsecase, c.usecase) IS NOT NULL
            THEN { usecase: coalesce(c.instanceUsecase, c.usecase), provider: c.instanceProvider, export: coalesce(c.instanceExport, false) }
            ELSE null END,
  type: coalesce(c.type, 'course'),
  isCertification: c:Certification,
  certificateType: coalesce(c.certificateType, 'completion'),
  categories: [(c)-[r:IN_CATEGORY]->(cat:Category) WHERE cat.title IS NOT NULL | cat {
    .title, .slug, hidden: coalesce(cat.hidden, false), .layout, order: r.order,
    parentHidden: COUNT { (cat)<-[:HAS_CHILD]-(p:Category) WHERE p.hidden = true } > 0
  }],
  modules: [(c)-[:HAS_MODULE]->(m:Module) WHERE NOT m:DeletedModule | m {
    .slug, .title, .order, .ctaText,
    lessons: [(m)-[:HAS_LESSON]->(l:Lesson) WHERE NOT l:DeletedLesson | l {
      .slug, .title, .type, optional: l:OptionalLesson, .duration, .order
      /* … ~15 more per-lesson CASE feature maps (query/console/iframe/instance/terms…) */
    }]
  }],
  prerequisites: [(c)<-[:PROGRESS_TO]-(pre:Course) | pre.slug]
} AS course
```

```text
// params: $slug = 'cypher-fundamentals'
```

Stresses: three-deep pattern comprehensions (course→module→lesson) in one row — materialisation cost of nested lists, not selectivity.

**neode:** `Repository#findBy` on a Course model carrying `@RelatedMany({ path: [{ type: 'HAS_MODULE' }, { type: 'HAS_LESSON' }], fields: [...] })` (multi-hop `path`, NTS-547) — one query, same comprehension shape; the per-lesson CASE map beyond projections → `neode.cypher()` escape hatch.

### R3 · courses-page — listing pagination + count

```cypher
MATCH (c:Course) WHERE c.status IN $statuses
  AND ($includePrivate OR coalesce(c.visibility, 'public') <> 'private')
  /* ${DRAFT_VISIBILITY} — draft guard: keeps drafts only when $includeDrafts
     or the $accessibleToSub account holds a GRANTED_ACCESS_TO / team
     ON_LEARNING_PATH_FOR edge (see Neo4jCourseRepository) */
RETURN c {
  .slug, .title, .shortTitle, .description, .thumbnail, .overview, .status,
  .duration, .language, .visibility,
  type: coalesce(c.type, 'course'),
  isCertification: c:Certification,
  categories: [(c)-[r:IN_CATEGORY]->(cat:Category) WHERE cat.title IS NOT NULL | cat {
    .title, .slug, hidden: coalesce(cat.hidden, false), .layout, order: r.order
  }]
} AS course
ORDER BY c.title ASC
SKIP $skip LIMIT $limit
```

```cypher
MATCH (c:Course) WHERE c.status IN $statuses
  AND ($includePrivate OR coalesce(c.visibility, 'public') <> 'private')
  /* ${DRAFT_VISIBILITY} */
RETURN count(c) AS total
```

```text
// params: $statuses = ['active','draft'], $includePrivate = false,
//         $includeDrafts = false, $accessibleToSub = null, $skip = 0, $limit = 20
```

Stresses: label scans under filter + the parallel COUNT twin — the two-read pagination pattern, index use on `c.status`/`c.visibility`.

**neode:** `neode.paginate(Course, filter, { page: 1, limit: 20, order: { title: 'ASC' } })` — `PaginateService` offset mode runs the same data + COUNT pair.

### R4 · enrolments-for-user — identity traversal + variable-length progress count

```cypher
MATCH (loggedIn:User {sub: $sub})-[:LINKED_TO*0..1]-(u:User)-[:HAS_ENROLMENT]->(e)-[:FOR_COURSE]->(c:Course)
WHERE NOT e:DeletedEnrolment
WITH u, e, c,
  COUNT { (e)-[:COMPLETED_LESSON]->(l:Lesson) WHERE NOT l:OptionalLesson AND NOT l:DeletedLesson } AS completedCount,
  COUNT { (c)-[:HAS_MODULE|HAS_LESSON*2]->(l) WHERE NOT l:OptionalLesson AND NOT l:DeletedLesson } AS totalCount
RETURN e { /* ENROLMENT_RETURN: percentage CASE, completedLessons comprehension,
             THROUGH_CATEGORY attribution, certificate fields */ } AS enrolment
ORDER BY e:CompletedEnrolment ASC, coalesce(e.lastSeenAt, e.updatedAt, e.createdAt) DESC
```

```text
// params: $sub = 'auth0|abc123'
```

Stresses: `LINKED_TO*0..1` identity fan-out × per-enrolment variable-length `HAS_MODULE|HAS_LESSON*2` COUNT — the platform's hottest read shape (`ENROLMENT_PROGRESS` fragment).

**neode:** `neode.traverse(User).hop('LINKED_TO','both',User,{degrees:'0..1'}).hop('HAS_ENROLMENT','out').hop('FOR_COURSE','out').run()` for the path rows + `@RelationshipCount` projections for the counts; the exact `ENROLMENT_RETURN` projection → `neode.cypher()`.

### R5 · lesson-questions — quiz questions with ordered answers

```cypher
MATCH (c:Course {slug: $courseSlug})-[:HAS_MODULE]->(m:Module {slug: $moduleSlug})
   -[:HAS_LESSON]->(l:Lesson {slug: $lessonSlug})-[:HAS_QUESTION]->(q:Question)
WHERE NOT q:DeletedQuestion
CALL {
  WITH q
  MATCH (q)-[:HAS_ANSWER]->(a:Answer)
  WHERE NOT a:DeletedAnswer
  WITH a ORDER BY coalesce(a.order, 0)
  RETURN collect(a { id: coalesce(a.id, elementId(a)), .text, .correct, .order }) AS options
}
RETURN q {
  .id, .title, .text, .type, .match, .hint, .solution, .source, .language,
  options: options
} AS question
ORDER BY coalesce(q.order, 0)
```

```text
// params: $courseSlug = 'cypher-fundamentals', $moduleSlug = 'module-1',
//         $lessonSlug = 'intro-to-graphs'
```

Stresses: correlated CALL subquery per question row (sorted collect) — subquery startup cost vs fan-out on `HAS_ANSWER`.

**neode:** `Repository#findBy` with a nested load spec (`with({ questions: { answers: true } })` — nested `@RelatedMany` spec, NTS-560), or `Builder#call` + `collectSubquery` for the exact CALL shape.

### R6 · recommendations — collaborative filtering (co-completion)

```cypher
MATCH (a:User)-[:HAS_ENROLMENT]->(se:CompletedEnrolment)-[:FOR_COURSE]->(source:Course {slug: $sourceCourseSlug})
WHERE NOT se:DeletedEnrolment
MATCH (a)-[:LINKED_TO*0..1]-(:User)-[:HAS_ENROLMENT]->(te:CompletedEnrolment)-[:FOR_COURSE]->(target:Course)
WHERE NOT te:DeletedEnrolment
  AND target <> source
  AND NOT target:DeletedCourse
  AND target.status IN $statuses
  AND coalesce(target.visibility, 'public') <> 'private'
WITH target,
  count(DISTINCT coalesce(head([(a)-[:LINKED_TO]->(canonical:User) | canonical.sub]), a.sub)) AS rawCount
RETURN target.slug AS courseSlug, rawCount,
  target {
    .slug, .title, .shortTitle, .description, .thumbnail, .overview, .status,
    .duration, .language, .visibility,
    type: coalesce(target.type, 'course'),
    categories: [(target)-[r:IN_CATEGORY]->(cat:Category) WHERE cat.title IS NOT NULL | cat {
      .title, .slug, hidden: coalesce(cat.hidden, false), .layout, order: r.order
    }]
  } AS course
ORDER BY rawCount DESC
LIMIT 20
```

```text
// params: $sourceCourseSlug = 'cypher-fundamentals', $statuses = ['active','draft']
```

Stresses: full co-occurrence fan-out (all completers of a course × all their completions) + `count(DISTINCT …)` identity de-dup — aggregation memory at 1M-enrolment scale.

**neode:** aggregate traversal — `neode.traverse(Enrolment).where(...).hop('FOR_COURSE','out',Course).hop(...)  .exclude(...).groupBy('target').countDistinct('a','rawCount').orderBy('rawCount','DESC').limit(20).runAggregates()` (NTS-547 co-purchase shape).

### R7 · team-leaderboard — points aggregation

```cypher
MATCH (t:Team {id: $teamId})<-[:MEMBER_OF]-(u)-[:HAS_ENROLMENT]->(e)-[:FOR_COURSE]->(c)
WITH t, u, e, c,
  COUNT { (c)-[:HAS_MODULE|HAS_LESSON*2]->(l) WHERE NOT l:OptionalLesson } AS lessons,
  COUNT { (e)-[:COMPLETED_LESSON]->(l:Lesson) WHERE NOT l:OptionalLesson AND NOT l:DeletedLesson } AS lessonsDone,
  coalesce(c.points, CASE WHEN c:Certification THEN 50 ELSE 10 END) AS pointsAvailable
ORDER BY e.createdAt DESC
WITH t, u, e, c, lessons, lessonsDone, pointsAvailable,
  CASE
    WHEN c:Certification AND e:CompletedEnrolment THEN 1.0
    WHEN c:Certification AND NOT e:CompletedEnrolment THEN 0.2
    WHEN lessons = 0 THEN 0.2
    ELSE 1.0 * lessonsDone / lessons
  END AS completedPct
WITH t, u,
  collect([ c { .link, .slug, .title }, e:CompletedEnrolment ]) AS courses,
  sum(pointsAvailable * completedPct) AS points,
  min(e.createdAt) AS firstEnrolment,
  count(*) AS cnt
ORDER BY points DESC, cnt DESC, firstEnrolment DESC
WITH collect({
  user: u { .id, .sub, .name, .firstName, .lastName, .picture, profileHidden: u:HiddenProfile },
  points: points,
  firstEnrolment: toString(firstEnrolment),
  percentage: CASE WHEN cnt > 0 THEN 100.0 * size([ n IN courses WHERE n[1] | n ]) / cnt ELSE 0 END,
  count: cnt,
  completed: size([ n IN courses WHERE n[1] | n ]),
  courses: [ n IN courses WHERE n[1] | { link: n[0].link, title: n[0].title, slug: n[0].slug } ]
}) AS leaderboard
RETURN leaderboard[0..20] AS leaderboard
```

```text
// params: $teamId = 'team-abc123'
```

Stresses: multi-stage WITH aggregation (per-row COUNT subqueries → CASE → sum/collect per user) — the heaviest aggregation chain in the app.

**neode:** `neode.cypher()` escape hatch — the points math is deeper than projections express; the per-course counts alone map to `@RelationshipCount` reads.

### R8 · course-search — full-text via queryNodes

```cypher
CALL db.index.fulltext.queryNodes('courseSearch', $query) YIELD node AS c, score
WHERE c.status IN $statuses
  AND ($includePrivate OR coalesce(c.visibility, 'public') <> 'private')
  /* ${DRAFT_VISIBILITY} */
RETURN c {
  .slug, .title, .shortTitle, .description, .thumbnail, .overview, .status,
  .duration, .language, .visibility,
  type: coalesce(c.type, 'course'),
  categories: [(c)-[r:IN_CATEGORY]->(cat:Category) WHERE cat.title IS NOT NULL | cat {
    .title, .slug, hidden: coalesce(cat.hidden, false), .layout, order: r.order
  }]
} AS course
ORDER BY score DESC, c.title ASC
SKIP $skip LIMIT $limit
```

```text
// params: $query = 'cypher fundamentals' (already through toFulltextQuery()),
//         $statuses = ['active','draft'], $includePrivate = false,
//         $includeDrafts = false, $accessibleToSub = null, $skip = 0, $limit = 20
```

Stresses: Lucene index scoring + post-YIELD filter + sort on score — procedure plan shape vs index seeks.

**neode:** `neode.search(Course, 'courseSearch', toFulltextQuery(q), 20)` (or `Repository#search`) — same `queryNodes` call, hydrated + scored.

### R9 · course-access — multi-account identity traversal

```cypher
MATCH (loggedIn:User {sub: $sub})-[:LINKED_TO*0..1]-(linked:User)
MATCH (course:Course {slug: $courseSlug})
WITH course, collect(DISTINCT linked) AS accounts
RETURN any(account IN accounts WHERE
  EXISTS {
    MATCH (account)-[:MEMBER_OF]->(:Team)<-[:ON_LEARNING_PATH_FOR]-(course)
  }
  OR EXISTS {
    MATCH (account)-[:GRANTED_ACCESS_TO]->(course)
  }
) AS hasAccess
```

```text
// params: $sub = 'auth0|abc123', $courseSlug = 'cypher-fundamentals'
```

Stresses: zero-or-one-hop undirected var-length + per-account `EXISTS` probes — the authz pattern every GraphAcademy read shares.

**neode:** `neode.traverse(User).hop('LINKED_TO','both',User,{degrees:'0..1'})` + `Builder#whereExistsSubquery` for the probes; one-liner twin: `neode.cypher()`.

### R10 · certificate-lookup — public certificate by id

```cypher
MATCH (u:User)-[:HAS_ENROLMENT]->(e:Enrolment)-[:FOR_COURSE]->(c:Course)
WHERE e.certificateId = $certificateId
WITH u, e, c,
  coalesce(c.certificateType, 'completion') AS certType,
  head([ (e)-[:AT_EVENT]->(ev:Event)-[ic:INCLUDES_COURSE]->(c) | ic.date ]) AS eventDate,
  trim(coalesce(u.firstName, '') + ' ' + coalesce(u.lastName, '')) AS fullName
WHERE (certType = 'completion' AND e:CompletedEnrolment) OR certType = 'attendance'
RETURN {
  certificateId: e.certificateId,
  sub: coalesce(u.sub, u.id),
  userId: u.id,
  displayName: fullName,
  courseSlug: c.slug,
  courseTitle: c.title,
  courseVisibility: CASE WHEN c.visibility = 'private' THEN 'private' ELSE 'public' END,
  certificateType: certType,
  completedAt: toString(CASE certType
    WHEN 'attendance' THEN coalesce(eventDate, e.createdAt)
    ELSE e.completedAt END),
  startedAt: toString(e.createdAt),
  courseDurationMinutes: toInteger(coalesce(c.duration, 0)),
  proofUrl: e.proofUrl,
  proofNote: e.proofNote
} AS certificate
```

```text
// params: $certificateId = '8f14e45f-ceea-467f-abf5-0fed02ac1f99'
// (deliberately includes :DeletedEnrolment — shared links never break)
```

Stresses: unique-index lookup on `e.certificateId` + hop to two related nodes — cheap, but the WHERE-in-fragment shape (`CERTIFICATE_PROJECTION`) is reusable in the negative case too (miss → zero rows).

**neode:** `neode.getRepository(Enrolment).findBy({ certificateId })` on a model with `@RelatedOne` hops (user, course) projecting the certificate fields.

### R11 · activity-timeseries — per-day completion counts

```cypher
MATCH (loggedIn:User {sub: $sub})-[:LINKED_TO*0..1]-(u:User)-[:HAS_ENROLMENT]->(e:Enrolment)
WHERE e.lastSeenAt >= datetime.truncate('day') - duration('P90D')
MATCH (e)-[r:COMPLETED_LESSON]->(l:Lesson)
WITH date(coalesce(r.createdAt, e.lastSeenAt, e.updatedAt)) AS date,
     count(DISTINCT l) AS lessonCount
WHERE date >= date.truncate('day') - duration('P90D') AND lessonCount > 0
RETURN toString(date) AS date, lessonCount
ORDER BY date DESC
```

```text
// params: $sub = 'auth0|abc123'
```

Stresses: temporal bucketing (`date()` + truncate) over relationship properties of one user's full completion fan-out.

**neode:** `neode.readCypher(query, params)` — grouped temporal aggregation has no projection equivalent; this is the library's raw-read twin.

### R12 · latest-unenrolled — anti-join fan-out

```cypher
MATCH (loggedIn:User {sub: $sub})-[:LINKED_TO*0..1]-(u:User)
WITH collect(u) AS users
MATCH (c:Course)
WHERE c.status = 'active'
  AND c.createdAt IS NOT NULL
  AND coalesce(c.visibility, 'public') <> 'private'
  AND none(u IN users WHERE (u)-[:HAS_ENROLMENT]->()-[:FOR_COURSE]->(c))
RETURN c {
  .slug, .title, .shortTitle, .description, .thumbnail, .overview, .status,
  .duration, .language, .visibility,
  type: coalesce(c.type, 'course'),
  categories: [(c)-[r:IN_CATEGORY]->(cat:Category) WHERE cat.title IS NOT NULL | cat {
    .title, .slug, hidden: coalesce(cat.hidden, false), .layout, order: r.order
  }]
} AS course
ORDER BY c.createdAt DESC
LIMIT $limit
```

```text
// params: $sub = 'auth0|abc123', $limit = 3
```

Stresses: `none()` anti-join — every active course probed against the user's whole enrolment set; worst-case cartesian behaviour when the user has many enrolments.

**neode:** `Builder#whereRaw('none(u IN users WHERE …)')` inside a `neode.query()` chain, or `neode.cypher()`.

---

## 3. Write benchmarks

### W1 · user-login-upsert — MERGE with coalesce guards

```cypher
MERGE (u:User {sub: $sub})
ON CREATE SET
  u.id = randomUUID(),
  u.email = $email,
  u.emailVerified = $emailVerified,
  u.name = $name,
  u.picture = $picture,
  u.role = $role,
  u.createdAt = datetime(),
  u.updatedAt = datetime()
ON MATCH SET
  u.id = coalesce(u.id, randomUUID()),
  u.email = coalesce($email, u.email),
  u.emailVerified = coalesce($emailVerified, u.emailVerified),
  u.name = coalesce($name, u.name),
  u.picture = coalesce($picture, u.picture),
  u.createdAt = coalesce(u.createdAt, datetime()),
  u.updatedAt = datetime()
RETURN u { /* USER_FIELDS projection */ } AS u
```

```text
// params: $sub = 'auth0|abc123', $email = 'a@b.com', $emailVerified = true,
//         $name = 'Adam Cowley', $picture = null, $role = 'user'
```

Stresses: lock ordering on the unique `User.sub` — every login serialises here; measures MERGE-contended point write throughput.

**neode:** `neode.mergeOn(User, { sub }, set)` — MERGE on match fields + guarded SET; `@CreatedAt`/`@UpdatedAt`/`Default` decorators supply the server-side stamps; `Repository#save` for the plain pk-MERGE variant.

### W2 · enrol — enrolment MERGE with attribution edges

```cypher
MATCH (c:Course {slug: $courseSlug})
MERGE (u:User {sub: $sub})
ON CREATE SET u.id = randomUUID(), u.createdAt = datetime(),
    u.firstName = $firstName,
    u.name = $name,
    u.picture = $picture
SET u.email = coalesce($email, u.email), u.id = coalesce(u.id, randomUUID()),
    u.refs = CASE WHEN $ref IS NOT NULL THEN apoc.coll.toSet(coalesce(u.refs, []) + $ref)
        ELSE u.refs END,
    u.categories = CASE WHEN $category IS NOT NULL THEN apoc.coll.toSet(coalesce(u.categories, []) + $category) ELSE u.categories END
MERGE (e:Enrolment {id: apoc.text.base64Encode($courseSlug +'--'+ u.sub)})
ON CREATE SET e.createdAt = datetime()
ON MATCH SET e.updatedAt = datetime()
SET e.lastSeenAt = datetime(),
    e.ref = $ref,
    e.teamId = $teamId,
    e.category = $category
MERGE (u)-[:HAS_ENROLMENT]->(e)
MERGE (e)-[:FOR_COURSE]->(c)
SET e.certificateId = CASE
    WHEN coalesce(c.certificateType, 'completion') = 'attendance'
    THEN coalesce(e.certificateId, randomUUID())
    ELSE e.certificateId END
FOREACH (slug IN CASE WHEN $category IS NOT NULL THEN [$category] ELSE [] END |
    MERGE (cat:Category {slug: slug})
    MERGE (e)-[r:THROUGH_CATEGORY]->(cat)
    ON CREATE SET r.createdAt = datetime()
)
WITH e, u, c
CALL {
  WITH e
  MATCH (fromPost:Post {slug: $fromPost})
  MERGE (e)-[fp:FROM_POST]->(fromPost)
  ON CREATE SET fp.createdAt = datetime()
}
REMOVE e:FailedEnrolment
RETURN e { /* minimal create-time projection (~14 fields) */ } AS enrolment
```

```text
// params: $sub = 'auth0|abc123', $courseSlug = 'cypher-fundamentals',
//         $teamId = null, $ref = 'newsletter', $category = 'data-modeling',
//         $fromPost = null, $name = 'Adam Cowley', $firstName = 'Adam',
//         $picture = null, $email = 'a@b.com'
```

Stresses: multi-entity upsert in one statement — MERGE on User + deterministic-id Enrolment + conditional FOREACH/CALL edges; concurrent first-enrolment races on the same deterministic id.

**neode:** `neode.inWriteTransaction` + `mergeOn(User…)`/`mergeOn(Enrolment…)` + `relate(...)` for the edges; the deterministic-id + FOREACH conditionals → `Builder#forEach`/`neode.writeCypher` for an exact twin.

### W3 · lesson-complete — idempotent edge MERGE with properties

```cypher
MATCH (loggedIn:User {sub: $sub})-[:LINKED_TO*0..1]-(u:User)-[:HAS_ENROLMENT]->(e:Enrolment)-[:FOR_COURSE]->(c:Course {slug: $courseSlug})
WHERE NOT e:DeletedEnrolment
WITH u, e, c
ORDER BY e:CompletedEnrolment DESC, coalesce(e.completedAt, e.updatedAt, e.createdAt) DESC
LIMIT 1
WITH u, e, c, [(c)-[:HAS_MODULE]->(:Module)-[:HAS_LESSON]->(l:Lesson {slug: $lessonSlug}) | l][0] AS l
FOREACH (_ IN CASE WHEN l IS NULL THEN [] ELSE [1] END |
  MERGE (e)-[r:COMPLETED_LESSON]->(l)
  ON CREATE SET r.createdAt = datetime(), r.completionMethod = $completionMethod
)
SET e.updatedAt = datetime()
WITH e, u, c, l,
  COUNT { (e)-[:COMPLETED_LESSON]->(cl:Lesson) WHERE NOT cl:OptionalLesson AND NOT cl:DeletedLesson } AS completedCount,
  COUNT { (c)-[:HAS_MODULE|HAS_LESSON*2]->(cl) WHERE NOT cl:OptionalLesson AND NOT cl:DeletedLesson } AS totalCount
RETURN e {
  .id, userId: coalesce(u.sub, u.id), courseSlug: c.slug,
  completed: e:CompletedEnrolment, completedCount: completedCount,
  completedPercentage: CASE WHEN totalCount = 0 THEN 0 WHEN e:CompletedEnrolment OR completedCount >= totalCount THEN 100 ELSE toInteger(completedCount * 100 / totalCount) END
  /* … remaining ENROLMENT_RETURN fields */
} AS enrolment,
l IS NOT NULL AS lessonFound
```

```text
// params: $sub = 'auth0|abc123', $courseSlug = 'cypher-fundamentals',
//         $lessonSlug = 'intro-to-graphs', $completionMethod = 'auto-advance'
```

Stresses: the app's highest-frequency write — MERGE edge with `ON CREATE` props (idempotent re-click) plus the two progress COUNT subqueries recomputed on every call.

**neode:** `neode.relate(Enrolment, e, l, 'completedLessons', { completionMethod })` — MERGE-based edge, idempotent by construction (note: takes the declared field key, the Cypher type is `COMPLETED_LESSON`); the progress recount → `@RelationshipCount` projection read.

### W4 · quiz-attempt — the big single-statement quiz write (`logLessonAttempt`)

```cypher
MATCH (loggedIn:User {sub: $sub})-[:LINKED_TO*0..1]-(u:User)-[:HAS_ENROLMENT]->(e:Enrolment)-[:FOR_COURSE]->(c:Course {slug: $courseSlug})
WHERE NOT e:DeletedEnrolment
WITH u, e, c
ORDER BY e:CompletedEnrolment DESC, coalesce(e.completedAt, e.updatedAt, e.createdAt) DESC
LIMIT 1
MATCH (c)-[:HAS_MODULE]->(m:Module {link: $moduleLink})
      -[:HAS_LESSON]->(l:Lesson {link: $lessonLink})

SET e.lastSeenAt = datetime(), e.updatedAt = datetime()

CREATE (a:Attempt {id: randomUUID(), createdAt: datetime()})
CREATE (e)-[:HAS_ATTEMPT]->(a)
CREATE (a)-[:ATTEMPTED_LESSON]->(l)

FOREACH (_ IN CASE WHEN $allCorrect THEN [1] ELSE [] END |
  SET a:SuccessfulAttempt
  MERGE (e)-[r:COMPLETED_LESSON]->(l)
  ON CREATE SET r.createdAt = datetime()
)

WITH u, e, c, m, l, a,
  COUNT { (m)-[:HAS_LESSON]->(les) WHERE NOT les:OptionalLesson } AS moduleLessonCount,
  COUNT { (e)-[:COMPLETED_LESSON]->(les)<-[:HAS_LESSON]-(m) WHERE NOT les:OptionalLesson } AS moduleCompletedCount
FOREACH (_ IN CASE WHEN moduleLessonCount > 0 AND moduleCompletedCount >= moduleLessonCount THEN [1] ELSE [] END |
  MERGE (e)-[r:COMPLETED_MODULE]->(m)
  ON CREATE SET r.completedAt = datetime()
)

WITH u, e, c, l, a

CALL {
  WITH a
  UNWIND $answers AS row
  MATCH (q:Question {id: row.questionId})
  CREATE (a)-[:PROVIDED_ANSWER {answers: row.answers, correct: row.correct}]->(q)
  RETURN count(*) AS _answersWritten
}

WITH DISTINCT u, e, c,
  COUNT { (e)-[:COMPLETED_LESSON]->(cl:Lesson) WHERE NOT cl:OptionalLesson AND NOT cl:DeletedLesson } AS completedCount,
  COUNT { (c)-[:HAS_MODULE|HAS_LESSON*2]->(cl) WHERE NOT cl:OptionalLesson AND NOT cl:DeletedLesson } AS totalCount
RETURN /* ENROLMENT_RETURN projection */ e { .id } AS enrolment
```

```text
// params: $sub = 'auth0|abc123', $courseSlug = 'cypher-fundamentals',
//         $moduleLink = 'cypher-fundamentals/module-1', $lessonLink = '.../quiz',
//         $allCorrect = true,
//         $answers = [{ questionId: 'q-1', answers: ['a-2'], correct: true }, …]
```

Stresses: the widest single statement — attempt CREATE, conditional completion MERGEs, module auto-complete COUNTs, and an UNWIND answer fan-out, all in one transaction; measures per-statement write contention and plan complexity.

**neode:** `neode.writeCypher` / `neode.cypher` escape hatch for the exact statement; decomposed twin: `inWriteTransaction` + `create(Attempt)` + `relate(...)` ×3 + conditional completion `relate` + `mergeMany` for the answers.

### W5 · cert-attempt — attempt create with UNWIND question assignment

```cypher
MATCH (u:User {sub: $sub})
MATCH (c:Course:Certification {slug: $courseSlug})
MATCH (u)-[:HAS_ENROLMENT]->(e:Enrolment)-[:FOR_COURSE]->(c)
CREATE (a:CertificationAttempt {
  id: randomUUID(),
  createdAt: datetime(),
  expiresAt: datetime($expiresAt),
  updatedAt: datetime()
})
CREATE (e)-[:HAS_ATTEMPT]->(a)
WITH a, u, c
UNWIND range(0, size($questionIds)-1) AS idx
MERGE (q:CertificationQuestion {id: $questionIds[idx]})
CREATE (a)-[:ASSIGNED_QUESTION {order: idx}]->(q)
WITH a, u, c LIMIT 1
RETURN /* ATTEMPT_RETURN: status CASE + per-kind COUNT projections */ a { .id } AS attempt
```

```text
// params: $sub = 'auth0|abc123', $courseSlug = 'graphacademy-certified-professional',
//         $questionIds = ['q-01', 'q-02', …] (~40), $expiresAt = '2026-11-14T10:00:00Z'
// (runs after the lock statement: SET u.id = coalesce(…) + MERGE the Enrolment)
```

Stresses: ordered UNWIND fan-out (`range` + indexed access) creating N `ASSIGNED_QUESTION` edges in one statement — burst edge-creation cost.

**neode:** `Builder#unwind('range(0, size($questionIds)-1)', 'idx')` + `create()` inside `neode.inWriteTransaction`, or `neode.runAll([...])` for the lock + create pair.

### W6 · sync-reconcile — UNWIND upsert with soft-delete labels

```cypher
UNWIND $nodes AS n
MERGE (l:Lesson {link: n.lessonLink})
SET l.slug              = n.lessonSlug,
    l.title              = n.title,
    l.type               = n.type,
    l.order              = toInteger(n.order),
    l.duration           = toInteger(n.duration),
    l.video              = n.video,
    l.queryOpen          = n.queryOpen,
    l.queryCypher        = n.queryCypher,
    l.dataModelOpen      = n.dataModelOpen,
    l.consoleTool        = n.consoleTool,
    l.consoleTitle       = n.consoleTitle,
    l.iframeUrl          = n.iframeUrl,
    l.iframeTitle        = n.iframeTitle,
    l.tags               = n.tags,
    l.summary            = n.summary,
    l.about              = n.about,
    l.videoUploadDate    = n.videoUploadDate,
    l.public             = n.public,
    l.autorun            = n.autorun,
    l.instanceUsecase    = n.instanceUsecase,
    l.instanceProvider   = n.instanceProvider,
    l.instanceExport     = n.instanceExport,
    l.termsInclude       = n.termsInclude,
    l.termsExclude       = n.termsExclude,
    l.updatedAt          = datetime()
REMOVE l:DeletedLesson
FOREACH (_ IN CASE WHEN n.optional THEN [1] ELSE [] END | SET l:OptionalLesson)
FOREACH (_ IN CASE WHEN n.optional THEN [] ELSE [1] END | REMOVE l:OptionalLesson)
```

```text
// params: $nodes = [{ lessonLink: 'course/m1/l1', lessonSlug: 'l1', title: '…',
//                     optional: false, … }, …]  (full content payload, ~10k rows)
// companion soft-delete pass in the same sync (same UNWIND shape):
//   UNWIND $rows AS row
//   MATCH (c:Course {slug: row.courseSlug})-[:HAS_MODULE]->(m)
//   WHERE NOT m.link IN row.validModuleLinks
//   SET m:DeletedModule
//   FOREACH (l IN [(m)-[:HAS_LESSON]->(x:Lesson) | x] | SET l:DeletedLesson)
//   DELETE r
```

Stresses: bulk MERGE-by-natural-key with 20+ property SETs and label toggles — content-sync batch throughput; the soft-delete twin adds label writes + relationship deletes.

**neode:** `neode.mergeMany(Lesson, rows)` — BulkService emits the same UNWIND MERGE (chunked, merge-field keyed); label state via `@SoftDelete` / `addLabel()`-`removeLabel()`; the delete pass → `Builder#detachDelete`.

### W7 · reward-reserve — CAS guard write

```cypher
MATCH (u:User {sub: $userId})
WHERE NOT EXISTS {
  MATCH (u)-[:HAS_REWARD_ORDER]->(existing:RewardOrder {rewardSlug: $rewardSlug})
  WHERE existing.status <> 'failed'
}
CREATE (u)-[:HAS_REWARD_ORDER]->(o:RewardOrder)
SET o.rewardSlug = $rewardSlug,
    o.status     = 'pending',
    o.createdAt  = datetime($createdAt)
RETURN true AS created
```

```text
// params: $userId = 'auth0|abc123', $rewardSlug = 'neo4j-tshirt', $createdAt = '2026-11-14T09:00:00Z'
```

Stresses: compare-and-set under contention — zero rows (no write) when the guard fails, CREATE only on first writer; the double-order-prevention pattern.

**neode:** `Builder#whereRaw('NOT EXISTS { … }')` (or `whereExistsSubquery` + negation) then `create()`, in `neode.inWriteTransaction`; no declarative CAS — raw twin: `neode.writeCypher`.

### W8 · reminder-candidates — the big filtered scan (`findReminderCandidates`)

```cypher
MATCH (u:User)-[:HAS_ENROLMENT]->(e:Enrolment)-[:FOR_COURSE]->(c:Course)
WHERE NOT e:CompletedEnrolment
  AND NOT e:DeletedEnrolment
  AND coalesce(u.unsubscribed, false) = false
  AND coalesce(c.isCertification, false) = false
  AND c.status = 'active'
  AND e.lastSeenAt IS NOT NULL
  AND e.lastSeenAt < datetime() - duration({hours: 168})
  AND ($since IS NOT NULL OR e.lastSeenAt >= datetime() - duration({hours: 180}))
  AND (
    e.reminderSentAt IS NULL
    OR ($since IS NULL AND e.reminderSentAt < datetime() - duration({days: 5}))
    OR ($since IS NOT NULL AND e.reminderSentAt < datetime($since))
  )
WITH u, e, c,
  COUNT { (e)-[:COMPLETED_LESSON]->(l:Lesson) WHERE NOT l:OptionalLesson AND NOT l:DeletedLesson } AS completedCount,
  COUNT { (c)-[:HAS_MODULE|HAS_LESSON*2]->(l) WHERE NOT l:OptionalLesson AND NOT l:DeletedLesson } AS totalCount
WHERE (totalCount = 0 OR completedCount < totalCount)
  AND NOT EXISTS {
    MATCH (u)-[:LINKED_TO*0..1]-(:User)-[:HAS_ENROLMENT]->(done:CompletedEnrolment)-[:FOR_COURSE]->(c)
  }
WITH u, e, c, COUNT {
  (u)-[:LINKED_TO*0..1]-(:User)-[:HAS_ENROLMENT]->(linkedE:Enrolment)
  WHERE linkedE.reminderSentAt IS NOT NULL
    AND linkedE.reminderSentAt >= datetime() - duration({days: 2})
} AS recentReminderCount
RETURN {
  email: u.email,
  firstName: coalesce(u.firstName, split(u.name, ' ')[0]),
  courseSlug: c.slug,
  courseTitle: c.title,
  certificateType: coalesce(c.certificateType, 'completion'),
  certificateId: e.certificateId,
  enrolmentId: e.id,
  lastSeenAt: toString(e.lastSeenAt),
  reminderSentAt: toString(e.reminderSentAt),
  recentReminderCount: recentReminderCount
} AS candidate
```

```text
// params: $since = null   (backfill mode: an ISO string instead)
// (read-shaped but batch-job tier — input to the bulk reminder writes; listed with writes)
```

Stresses: full `Enrolment` scan under 7 predicates + two `LINKED_TO*0..1` EXISTS/COUNT subqueries per candidate row — index (non-)use, aggregation memory, and filter selectivity at 1M enrolments.

**neode:** `neode.readCypher(query, params)` — the library twin runs the identical statement; nothing in the projection surface expresses this filter stack.

---

## 4. Capturing the library-generated query

Get the neode twin's Cypher text, then diff the two plans:

1. **Log every statement** — `neode.on(EventType.QUERY_EXECUTED, (e) => console.log(e.cypher, e.params, e.duration))` (fires for raw + service queries, inside and outside transactions), or wrap the connection once: `instrumentConnectionProvider(inner, (e) => log(e))`.
2. **Query text without executing** — build the statement with `neode.query()` (a `BoundBuilder`) or a standalone `Builder` and call `.build()` → `{ query, params }`. Compare the string against the raw query above before spending database time.
3. **Plans** — `neode.explain(query, params)` for the plan without executing; `neode.profile(query, params)` executes and returns the profiled plan. The same `EXPLAIN`/`PROFILE` prefixes work in Browser/cypher-shell for the raw side.
4. **What to compare**:
   - **Plan shape** (`EXPLAIN`): index seeks vs label scans (NodeByIndexSeek vs NodeByLabelScan + Filter), the variable-length expand on `LINKED_TO*0..1`, and where the `COUNT {}` subqueries land.
   - **db hits** (`PROFILE`): the summary's total DB hits per statement — the single most comparable number between the hand-written and generated statement.
   - **Wall time**: run each N times (≥10, interleaved, after a warm-up pass) with `:param`s fixed; compare p50/p95, not means.
   - **Rows + memory**: rows returned and peak heap for the aggregation queries (R6, R7, W8) — a generated statement that collects before aggregating will show up here.
5. **Fairness**: run both sides through the same driver/session config and routing (`READ` for R1–R12, `WRITE` for W1–W7), and pin `neode.setDatabase()` so you are not profiling different databases.
