---
'neode': minor
---
Projection reads no longer emit `OPTIONAL MATCH` (NTS-565): nested sorts on `@RelatedOne` keys compile to an `ORDER BY COLLECT { … }` subquery and relation reads use pattern comprehensions, per the house Cypher doctrine — no row drops, no row multiplication, null sort keys sort last ascending. `Builder.optionalMatch()` stays exported for raw-Cypher callers (the delete paths keep it deliberately: they bind related nodes to delete, not existence checks).
