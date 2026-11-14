# Porting hand-written Cypher to neode

_For codebases built on raw Cypher moving onto the OGM (NTS-690). The reference analysis is a
full query inventory of GraphAcademy (~350 app-side statements) — the splits below are measured
from it, not anecdotal._

Rough split seen in that analysis:

- **~65-70%** of statements map onto repositories / projections / pagination as-is,
- **~25-30%** need the query builder's advanced surface (subqueries, `unwind`, `forEach`,
  full-text, aggregation),
- **~5-10%** stay raw by design.

The goal is not 100% OGM — it is knowing which category each query falls into, and not
hand-writing the ones the library already owns.

## The decision rule

Ask what the query does:

| The query is…                                                                         | Home in neode                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A lookup / listing by key or filter, with pagination                                  | `Repository` / `neode.find`, `findById`, `findBy`, `paginate` (offset or cursor), `manyAndCount`                                                                             |
| A listing that carries graph context per row (counts, exists, nested DTOs, multi-hop) | Read-model projections: `@RelatedOne/Many` (with multi-hop `path`), `@RelationshipCount`, `@RelationshipExists`, `@LabelPresent`, `@Expression` — one query per read, no N+1 |
| An entity write with defaults/validation/timestamps                                   | `create` / `save` / `merge` / `update`, or bulk `createMany` / `mergeMany`                                                                                                   |
| A conditional write ("only if still in state X")                                      | `updateWhere()` (NTS-688) — compare-and-swap in one statement                                                                                                                |
| A relationship write                                                                  | `relate()` (MERGE, idempotent per pair), `syncEdges()` / `replaceRelationship()` for cardinality-one swaps                                                                   |
| A content-sync / reconcile (upsert rows, soft-delete the delta)                       | `mergeMany()` for the upsert half; the soft-delete delta is app logic over query results                                                                                     |
| A report / aggregation across the graph                                               | `Builder`: scoped `call()`, `countSubquery()` / `collectSubquery()` / `withCountSubquery()`, `unwind()`, `forEach()`, `orderByLabel`, full-text via `search()`               |
| A graph algorithm shape (shortest path, variable-degree hops)                         | `shortestPath()`, projections `path` hops with degrees, `traverse()` for bounded open-ended walks                                                                            |
| A linked-list / queue rebuild (`apoc.nodes.link`)                                     | **Raw** — `cypher()` with `{ hydrate: Model }` if you want entities back                                                                                                     |
| Dynamic property names, `SHOW`/`CALL db.*` introspection                              | **Raw** — `cypher()` / `readCypher()` / `inspectSchema()`                                                                                                                    |

## Worked mappings (from the reference analysis)

**Progress counting** — hand-written:

```cypher
MATCH (e:Enrolment {id: $id})-[:FOR_COURSE]->(c:Course)
RETURN COUNT { (e)-[:COMPLETED_LESSON]->(l) WHERE NOT l:OptionalLesson } AS completedCount,
       COUNT { (c)-[:HAS_MODULE|HAS_LESSON*2]->(l) WHERE NOT l:OptionalLesson } AS totalCount
```
OGM: declare `@RelationshipCount({ type: 'COMPLETED_LESSON', where: 'NOT node:OptionalLesson' })`
on the enrolment model and read the property — the projection query carries both counts.

**Identity sharing** — hand-written graphs root every read at
`MATCH (loggedIn {sub})-[:LINKED_TO*0..1]-(u)`. OGM: a named `@Filter` on the model
(`where: 'EXISTS { MATCH (node)-[:LINKED_TO*0..1]-(account:User {sub: $sub}) }'`) composes into
every standard read, parameterised per request via `withFilterParams`.

**Collaborative filtering / leaderboards** — aggregation over shared patterns: `Builder` with
`call()` subqueries and `withCountSubquery()`; keep it in a custom repository (the repo layer
is the documented home for statements the facade does not express).

**Certificates that never break** — GraphAcademy's certificate lookup deliberately includes
soft-deleted enrolments. `@SoftDelete` reads can opt back in per call
(`includeDeleted: true`) — the OGM models the policy, the port keeps the nuance.

**Label-as-state machines** (`CompletedEnrolment`, `FailedEnrolment`) — `addLabel()` /
`removeLabel()` on the entity, `@LabelPresent` for reads, and (if state must gate writes)
`updateWhere()` with a `NOT node:Completed` guard.

## When raw is the right answer

Keep a query raw when it is:

1. **Shape-stable and performance-tuned** — a hand-tuned 40-line statement with a plan you have
   verified does not get faster by translation. Put it in a custom repository behind a
   typed method, run it via `cypher()`/`writeCypher()`, hydrate with `{ hydrate: Model }`.
2. **Beyond the builder** — `UNION` is supported (NTS-687), but `CALL apoc.*` orchestration,
   `apoc.nodes.link` chains, dynamic `SET e.`$prop``, and `SHOW` probes stay raw.
3. **One-statement business writes** — see
   [investigations/atomic-multi-writes.md](./investigations/atomic-multi-writes.md): a single
   statement and a single transaction are both atomic; choose by round trips vs readability.

Raw does not mean outside the framework: every raw entry point participates in ambient and
explicit transactions, emits `QUERY_EXECUTED`, returns `QueryOutput`, and can hydrate entities.

## Porting order that works

1. **Schema first** — declare models with decorators; `installSchema()` replaces the
   constraints/indexes script; `schemaDrift()` diffs a live database against the models.
2. **Reads before writes** — projections and repositories remove the highest volume of
   hand-written Cypher; shape is contract (docs/decisions/0003-result-shapes.md).
3. **Writes second** — create/merge/update cover CRUD; `updateWhere()` and `relate()` cover
   the CAS and edge cases; bulk APIs cover imports and syncs.
4. **Raw last** — what remains in custom repositories is the app's real query surface:
   fewer, weirder, and worth their hand-tuning.
