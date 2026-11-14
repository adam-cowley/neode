---
'neode': minor
---
`withoutFilters: ['*']` (WITHOUT_ALL_FILTERS) is rejected on every public read (NTS-610): the facade reads (find / get / all / paginate / findManyAndCount / chunk / lazy / search / knn / withinDistance / relatedQuery), the transactional mirrors, Repository find / findAll, load-spec levels, the projection DSL's `withoutFilters()` and the traverse builder all throw a NeodeError — the reserved `'*'` is the write paths' internal re-hydration escape (save / create / merge re-reading what they just wrote, unchanged), and accepting it on reads let one user-supplied string switch off tenancy AND soft-delete filters. Disable filters by name instead (`withoutFilters: ['tenant', 'softDelete']`); `Repository.delete(pk)` now resolves the row through its own unfiltered lookup.
