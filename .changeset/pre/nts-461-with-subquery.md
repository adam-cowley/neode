---
'neode': patch
---
`withCountSubquery()` / `withCollectSubquery()` now join a trailing `WITH` clause instead of always opening their own, so aggregates compose with carried variables — `WITH u, e, c, COUNT { … } AS completedCount` — and stay filterable (`WHERE completedCount < totalCount`) and reusable in a later RETURN projection, with the same sub-builder parameter namespacing as the RETURN variants (NTS-461).
