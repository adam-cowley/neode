---
'neode': patch
---
`limit: 0` on the hydrated reads (`all()` / projections / repository `findAll`) now throws `NeodeError: limit must be a positive integer` instead of silently returning every row (NTS-606) — the same contract paginate already applied. A negative or non-integer limit is rejected too (`Builder.limit` used to render it verbatim, and a negative LIMIT means "no limit" in Cypher).
