---
'neode': patch
---

Real-Neo4j fixes from the NTS-490 verification pass (both classes were masked by the embedded engine's tolerant Cypher dialect):

- Builder: bridge a DELETE clause and a following `(OPTIONAL) MATCH` with `WITH *` (42N24), matching the existing CREATE/MERGE bridging — previously only the cascade-delete service emitted the required `WITH` by hand, so any other delete-then-match composition built Cypher that real Neo4j 5 rejects.
- Save/merge: un-set a property provided as `null` with `SET n.prop = null` instead of `DELETE n.prop` — real Neo4j 5 only allows DELETE on nodes and relationships (22NB1).

Pinned with unit snapshots and real-server regression tests for cascade delete, delete-then-read and null-property saves.
