---

## 'neode': patch

Query Builder: chaining `where*` after `callProcedure()` / `call()` / `unwind()` / `forEach()` now emits the `WHERE` keyword (`WHERE (…)` instead of a bare `(…)` predicate that failed with Neo4j error 42I06) (NTS-475).
