---
'neode': patch
---

Adds a `fields` option to `Repository#search()` so a search can scope the index to a subset of the model's declared `fulltext: true` properties (default: all of them) — the index name is still resolved deterministically via `fulltextIndexName()`, so declarative searches never need index-name strings.
