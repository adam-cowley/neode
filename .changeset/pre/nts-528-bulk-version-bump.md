---
'neode': patch
---

Fixes the bulk mergeMany version bump rendering invalid Cypher (NTS-528): `rowVersionBump` emitted the bare bump expression (`coalesce(this.version, 0) + 1`) as an `ON MATCH SET` item with no assignment target — a parse error on every `mergeMany` of a `@Version` model. It now renders the full assignment. Regression test: bulk mergeMany of a versioned model creates at 0 and bumps on match.
