---
'neode': minor
---

`Repository#knn(property, vector, k)` — the kNN counterpart of `Repository#search`: the vector index name is derived from the model's declared `@Vector` property instead of handed in by the caller, so a search reads `repository.knn('embedding', queryVector, 5)` with no index-name plumbing. Descriptive NeodeErrors name the fix when the property is unknown or not declared `@Vector`. `INeode` and `TransactionalService` now expose the facade's existing `knn` as well, so the read is available through every scope (facade, repository, open transaction). Integration tests cover the deriving path, the named-read-filter behaviour and both error cases.
