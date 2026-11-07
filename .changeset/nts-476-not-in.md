---
'neode': patch
---

Query Builder: `where(left, 'NOT IN', value)` now renders the valid `NOT <left> IN $param` form — the compound `NOT IN` operator emits Cypher that Neo4j 2026.x+ rejects (NTS-476).
