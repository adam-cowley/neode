---
'neode': patch
---

Fixes surfaced by the Neo4j Testcontainers CI job, where the embedded engine's Cypher dialect had been masking real-server behaviour:

- Cascade delete: emit `WITH` between a `DELETE` clause and the following `(OPTIONAL) MATCH` — real Neo4j rejects `DELETE` followed by `MATCH` with `42N24` (the embedded engine accepted it).
- Schema install/drop and drift application: run DDL statements sequentially — Neo4j aborts concurrent schema writes (schema-lock contention), which made `installSchema()` flaky against real servers.
- Schema install: skip property-type constraints (`typed: true`) unless the connection is flagged Enterprise — every attempt fails on Community and failed the whole install.
- `toJson()`: serialise driver `Duration` values canonically (`P0M1DT0S`) instead of the driver's own zero-omitting spelling (`P1DT`), and normalise the driver's `Integer`-typed point `srid` to a number (neo4j-driver v6).
- Full-text search: inline the validated `LIMIT` integer — the driver serialises JS numbers as floats and Neo4j rejects `LIMIT 1.0` (`22N03`).
