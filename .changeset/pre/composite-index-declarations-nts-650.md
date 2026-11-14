---
'neode': minor
---

Composite index declarations (NTS-650): `index: ['a', 'b']` on a model property declares one range index over N properties — created by `installSchema()`, detected and repaired by `schemaDrift()` / `applySchemaDrift()` — and the docs note Neo4j's limits: uniqueness constraints are single-property, node key constraints are the Enterprise composite analogue.
