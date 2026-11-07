# neode

## 1.0.0-next.1

### Major Changes

- 3640af3: Modern-stack rewrite: standard TC39 decorators, dual ESM+CJS build, strict TypeScript. See MIGRATION.md for the breaking changes.

### Minor Changes

- 366a34c: Builder: inline pattern properties can now carry raw Cypher expressions via `RawExpression` (`merge('cat', 'Category', { slug: new RawExpression('slug') })` renders `MERGE (cat:Category { slug: slug })` for FOREACH-bound variables, without parameterising the value), and `relationship()` accepts a `properties` argument rendered inline in the relationship pattern — parameterised for plain values, verbatim for `RawExpression` — so `CREATE (a)-[:PROVIDED_ANSWER { answers: row.answers }]->(q)` and expression-valued `ON CREATE SET` / `ON MATCH SET` (`onCreateSetExpr` / `onMatchSetExpr`) need no hand-written Cypher.
- 7019f2f: Query Builder: `withOrder(...)` / `withLimit(n)` attach ORDER BY / LIMIT to the preceding `WITH` clause (NTS-477), expressing a mid-query sort before a write — `WITH u, e, c` / `ORDER BY coalesce(e.updatedAt, e.createdAt) DESC` / `LIMIT 1` / `SET e:…`. They accept the same argument forms as `orderBy()` and throw when no `WITH` is the last clause; plain `orderBy()` / `limit()` keep their RETURN-position behaviour.
- 70d53a7: Query Builder: `withCountSubquery(alias, build, imports)` and `withCollectSubquery(alias, build, imports)` emit `COUNT { … }` / `COLLECT { … }` aggregate subqueries in WITH position (NTS-481), so the aggregate stays in scope and a later `return()` can project it — e.g. `RETURN round(100.0 * completed / total) AS progressPct` — which RETURN-position subqueries (42I38) and raw Cypher or CALL scaffolding could not express. RETURN-position `countSubquery` / `collectSubquery` are unchanged.
- 3597912: Query Builder: new `whereGroup(callback)` builds a parenthesised group of where conditions, e.g. `(n.name = $x OR (n.age > $y AND n.age < $z))` — the shapes flat AND/OR connectors cannot express because AND binds tighter than OR (NTS-484).
- d22877f: Query builder: `create()` and `merge()` accept extra labels for multi-label nodes — pass an array as the second argument (`create('p', ['Person', 'Admin'], { … })` renders `CREATE (p:Person:Admin { … })`; MERGE matches on all labels). Model-defined labels (`@NodeEntity({ labels: [...] })` / the map API's `labels` key) already flow into every facade create/merge — now pinned by tests and documented (NTS-486).
- 3640af3: Repository ergonomics for interface-first consumers: `update` renamed to `patch` so subclasses can implement domain interfaces that declare their own `update(id, input)` (NTS-454/458/459); `delete` and `increment` accept `{ ifExists: true }` to no-op instead of throwing on missing entities (NTS-455/457); new `countBy(property, params)` grouped-count helper (NTS-453); `cypher(query, params, { hydrate })` is now on `INeode` and usable inside transactions (NTS-452); atomic `increment` (NTS-435) and declarative `fulltext: true` + `Repository.search()` (NTS-436).

### Patch Changes

- 7f9102f: Fixes surfaced by the Neo4j Testcontainers CI job, where the embedded engine's Cypher dialect had been masking real-server behaviour:
  
  - Cascade delete: emit `WITH` between a `DELETE` clause and the following `(OPTIONAL) MATCH` — real Neo4j rejects `DELETE` followed by `MATCH` with `42N24` (the embedded engine accepted it).
  - Schema install/drop and drift application: run DDL statements sequentially — Neo4j aborts concurrent schema writes (schema-lock contention), which made `installSchema()` flaky against real servers.
  - Schema install: skip property-type constraints (`typed: true`) unless the connection is flagged Enterprise — every attempt fails on Community and failed the whole install.
  - `toJson()`: serialise driver `Duration` values canonically (`P0M1DT0S`) instead of the driver's own zero-omitting spelling (`P1DT`), and normalise the driver's `Integer`-typed point `srid` to a number (neo4j-driver v6).
  - Full-text search: inline the validated `LIMIT` integer — the driver serialises JS numbers as floats and Neo4j rejects `LIMIT 1.0` (`22N03`).
- 6933275: Builder: `return()`-based helpers — `countSubquery()`, `collectSubquery()` and `return()` itself — now lazily open a statement segment, so they work on a fresh builder with no preceding `match()`/`statement()` call (e.g. a standalone `RETURN COUNT { MATCH … } AS found` probe) instead of throwing "Builder has no open statement".
- c24ed5e: Query Builder: chaining `where*` after `callProcedure()` / `call()` / `unwind()` / `forEach()` now emits the `WHERE` keyword (`WHERE (…)` instead of a bare `(…)` predicate that failed with Neo4j error 42I06) (NTS-475).
- bea1b5b: Query Builder: `where(left, 'NOT IN', value)` now renders the valid `NOT <left> IN $param` form — the compound `NOT IN` operator emits Cypher that Neo4j 2026.x+ rejects (NTS-476).
- 2945044: Query Builder: a raw `$name` inside a `call()` / `forEach()` / `countSubquery()` / `collectSubquery()` / `whereExistsSubquery()` callback that is never registered on the sub-builder now throws a `NeodeError` naming the offending fragment when the query compiles, instead of silently rewriting the reference into an unbound `$subN_name` that only failed at execution with `Neo4jError: Expected parameter(s): subN_name` (NTS-478). Register sub-query values with `sub.param(name, value)`; `$`-shaped text inside string literals and backtick-quoted identifiers is never mistaken for a parameter.
- f98c30c: Query Builder: `statement(prefix)` now flushes the open where clause into the outgoing statement segment, like `match()` / `with()` / `create()` / `merge()` do — a pending `WHERE` no longer leaks into the following segment and renders after the wrong clause (NTS-479).
- 38a325c: Query Builder: chaining `create()`/`merge()` and then `match()` now emits a `WITH *` between the updating and reading clauses — Neo4j rejects the query without it ("WITH is required between CREATE and MATCH") (NTS-485).
- 56cde2e: Real-Neo4j fixes from the NTS-490 verification pass (both classes were masked by the embedded engine's tolerant Cypher dialect):
  
  - Builder: bridge a DELETE clause and a following `(OPTIONAL) MATCH` with `WITH *` (42N24), matching the existing CREATE/MERGE bridging — previously only the cascade-delete service emitted the required `WITH` by hand, so any other delete-then-match composition built Cypher that real Neo4j 5 rejects.
  - Save/merge: un-set a property provided as `null` with `SET n.prop = null` instead of `DELETE n.prop` — real Neo4j 5 only allows DELETE on nodes and relationships (22NB1).
  
  Pinned with unit snapshots and real-server regression tests for cascade delete, delete-then-read and null-property saves.
- 751b293: Fix Builder rendering of a statement that mixes parameterised `onCreateSet()`/`onMatchSet()` items with expression items (`onCreateSetExpr()`/`onMatchSetExpr()`): all ON CREATE SET items of a statement now coalesce into a single `ON CREATE SET` clause (same for ON MATCH SET), instead of rendering two separate clauses which is invalid Cypher (NTS-491).
- 37e8818: Query Builder: the `$subN_` rewrite applied to `call()` / `forEach()` / `countSubquery()` / `collectSubquery()` / `whereExistsSubquery()` sub-queries no longer touches `$name`-shaped text inside string literals or backtick-quoted identifiers, so quoted text like `'%s is $label'` survives verbatim instead of being corrupted into broken Cypher with phantom unbound `$subN_label` parameters (NTS-492).
- 45f7d1b: summary
