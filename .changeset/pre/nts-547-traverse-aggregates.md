---
'neode': minor
---

Aggregate mode for typed traversals: `neode.traverse(...)` gains `.exclude(from, type, to)` (`WHERE NOT (from)-[:TYPE]->(to)`), `.groupBy(...aliases)`, `.countDistinct(alias, as)`, `.orderBy(field, order?)` and `.limit(n)`, plus `runAggregates()` — returning one row per group with the group aliases hydrated and the distinct count as a number. This is the co-purchase shape (entities reached through shared origins, ranked by how many origins they share, excluding ones already connected to the start). `run()` keeps its path-row shape; the two modes do not mix.
