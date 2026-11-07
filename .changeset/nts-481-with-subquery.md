---
'neode': minor
---

Query Builder: `withCountSubquery(alias, build, imports)` and `withCollectSubquery(alias, build, imports)` emit `COUNT { … }` / `COLLECT { … }` aggregate subqueries in WITH position (NTS-481), so the aggregate stays in scope and a later `return()` can project it — e.g. `RETURN round(100.0 * completed / total) AS progressPct` — which RETURN-position subqueries (42I38) and raw Cypher or CALL scaffolding could not express. RETURN-position `countSubquery` / `collectSubquery` are unchanged.
