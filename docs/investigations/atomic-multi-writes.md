# Atomic multi-writes: single-statement business logic on neode

_Investigation (NTS-689) — how a consumer porting hand-written Cypher reproduces GraphAcademy-style
"one statement = one business operation" writes, what today's primitives cover, and where the
seams are._

The pattern under study: GraphAcademy packs an entire business transaction into ONE Cypher
statement. Two real examples from its codebase:

**The quiz write** (`logLessonAttempt`) — attempt node, per-answer rows, conditional lesson
completion, conditional module completion, in one statement:

```cypher
MATCH (u:User {sub: $sub})-[:LINKED_TO*0..1]-(u2)-[:HAS_ENROLMENT]->(e:Enrolment)-[:FOR_COURSE]->(c:Course {slug: $courseSlug})
MATCH (c)-[:HAS_MODULE]->(m:Module {link: $moduleLink})-[:HAS_LESSON]->(l:Lesson {link: $lessonLink})
SET e.lastSeenAt = datetime()
CREATE (a:Attempt {id: randomUUID(), createdAt: datetime()})
CREATE (e)-[:HAS_ATTEMPT]->(a)
CREATE (a)-[:ATTEMPTED_LESSON]->(l)
FOREACH (_ IN CASE WHEN $allCorrect THEN [1] ELSE [] END |
  SET a:SuccessfulAttempt
  MERGE (e)-[r:COMPLETED_LESSON]->(l)
  ON CREATE SET r.createdAt = datetime()
)
// …module-completion FOREACH, then UNWIND $answers AS row
//   CREATE (a)-[:PROVIDED_ANSWER {answers: row.answers, correct: row.correct}]->(q)
RETURN <progress projection>
```

**The event claim** (`claim`) — upsert user, one enrolment per event course, certificate
stamps, claim redemption, all-or-nothing.

## What neode covers today

| Need                                           | Primitive                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All-or-nothing across multiple statements      | `neode.transaction(cb)` / `inWriteTransaction(cb)` / explicit `beginTransaction()` — every facade, repository and builder call in the callback joins the one transaction; any failure rolls everything back                                          |
| Several statements compiled and run in one tx  | `runAll()` (with `TransactionError` carrying per-statement results), `tx.query()` BoundBuilder `.write()`                                                                                                                                            |
| Multi-write in one STATEMENT                   | `Builder`: `create()` + `relationship()` + `unwind()` + `forEach()` + `countSubquery()` compose single statements — the quiz write above is expressible as a builder chain returning the progress projection via `countSubquery`/`withCountSubquery` |
| Multi-write in one statement, several entities | `parallel(…, { mode: 'atomic' })` fans out one WRITE transaction per operation, all-or-nothing commit (NTS-631)                                                                                                                                      |
| Conditional write (the FOREACH guards)         | `updateWhere()` (NTS-688) for the node-level CAS; inside a builder statement, `forEach()` with `RawExpression` renders the `FOREACH (_ IN CASE WHEN … THEN [1] ELSE [] END                                                                           | …)` idiom verbatim |
| Idempotent edges with `ON CREATE SET` props    | `relate()` (MERGE-based) / `mergeMany()`                                                                                                                                                                                                             |
| One RETURN, hydrated                           | `hydrate()` / `hydrateFirst()` over any raw or builder output                                                                                                                                                                                        |

**Nothing is blocked**: the atomicity guarantee of a single statement (it either fully applies
or not at all) is reproduced by any single managed transaction — `transaction(cb)` gives the
same all-or-nothing boundary around several statements, and `runAll()`/`parallel(atomic)` give
it explicitly.

## The seams (what a porting consumer feels)

1. **Ergonomics, not capability.** The single-statement version is one round trip and one
   failed-possible unit; the neode shape is N service calls in one tx — same guarantee, N
   round trips. For the quiz write, the builder chain closes the gap (one statement, one
   round trip) at the cost of building a 20-line chain instead of a 20-line string.
2. **Conditional multi-entity writes have no sugar.** `FOREACH … CASE WHEN` control flow is
   expressible (`forEach()` + `RawExpression`) but is deliberately raw-shaped: the builder
   does not model "write B only if write A created something" as data. A consumer who wants
   the guard at the app level uses `updateWhere()` per entity inside one tx — atomicity is
   preserved, the guard becomes a CAS instead of a FOREACH.
3. **Error reporting differs.** A raw statement fails with one driver error; a tx-scoped
   sequence fails at the statement that failed (better diagnostics, same rollback). Code
   matching on error _messages_ from the raw era needs to match on error classes instead
   (the 1.0 error taxonomy contract).
4. **Write counters.** MergeOutcome/MergeCounts (NTS-630) report per-call; a multi-statement
   tx reports per statement via `QUERY_EXECUTED` events — a consumer aggregating "what did
   this business op do?" should subscribe once and filter by tx, or keep the single-statement
   builder form and read its summary.

## Recommendation

- Document (porting recipe, NTS-690) the decision rule: **single statement when the writes
  are data-driven over one input row (UNWIND/FOREACH); one tx + services when the writes are
  control-flow-driven over entities.** Both are atomic; the trade is round trips vs
  readability.
- `updateWhere()` (NTS-688) removes the most common reason a hand-written statement bundles
  writes: the CAS guard. The reward-reservation and exam-seq patterns port to it directly.
- No new primitive is warranted by the evidence: the FOREACH-with-guard statements are rare,
  high-stakes, and shape-stable per app — the raw escape hatch (or a builder chain) is the
  right home for them. Revisit if a consumer shows a recurring family (e.g. leaderboard-style
  conditional aggregation writes).
