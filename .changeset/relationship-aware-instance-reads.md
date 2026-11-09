---
'neode': minor
---

Relationship-aware instance reads: `related(key)` gains `whereRelationship()` — filter on the traversed edge's own properties (`person.related('actedIn').whereRelationship({ role: 'Neo' }).find()`), composed with `where()` and the global filters inside the traversal's WHERE — and `withRelationship()`, which returns each row as `{ node, edge }` so callers read edge properties without dropping to a raw Builder (NTS-499; the `{ node, edge }` shape is the seed of the NTS-566 result-shape contract).
