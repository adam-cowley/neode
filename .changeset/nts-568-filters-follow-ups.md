---
'neode': minor
---
`withoutFilters` now plumbs through the transactional mirrors (`tx.find` / `tx.get` / `tx.all` / `tx.search`) with per-name independence, and the map API (`defineModel`) accepts a `filters` declaration with full `@Filter` parity
