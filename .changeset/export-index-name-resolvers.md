---
'neode': patch
---

Exports the deterministic index-name resolvers `vectorIndexName()` and `fulltextIndexName()` and the `OrderSpec` type: consumers of `knn()`/`search()` that do not go through `Repository#search` need the same naming `installSchema()` used when it created the indexes (found while building the Northwind demo — the service layer builds kNN queries against the Product embedding index).
