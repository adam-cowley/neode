---
'neode': patch
---

Graph type support (NTS-548): `installGraphType()` / `dropGraphType()` derive a Neo4j graph type (Enterprise Edition, Neo4j 2026.02+) from the registered models — node models become node element types (first label identifies, the rest are implied), property types are enforced with `:: TYPE` (required/exists → `NOT NULL`, unique → `IS UNIQUE`, arrays → `LIST<TYPE NOT NULL>`), and relationship declarations become relationship element types with properties from the relationship entity — applied as a single `ALTER CURRENT GRAPH TYPE SET`/`DROP` statement. Enterprise-flag gated like the other Enterprise-only DDL; also exports `deriveGraphType()` and the statement builders.
