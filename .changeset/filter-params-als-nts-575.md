---
'neode': patch
---
Filter params no longer leak across concurrent requests (NTS-575): `withFilterParams({ tenant }, async () => ...)` scopes named-filter values with AsyncLocalStorage, so interleaved async requests each read only their own value; the scope wins over `setFilterParams`, which stays as a documented process-wide default that is unsafe under concurrency. A filter whose `where` references `$name` with no value set now fails closed at query composition with a NeodeError naming the fix (`withFilterParams`, or `withoutFilters`), instead of an opaque driver error. Note: kNN reads still apply filters after top-k, so `k` is a ceiling (documented, not changed).
