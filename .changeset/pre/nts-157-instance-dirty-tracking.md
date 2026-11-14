---
'neode': minor
---

Instance dirty tracking with partial SET (NTS-157): hydrated entities snapshot their persisted scalar property values, and `save()` / instance `update()` write only what changed — a clean instance saves as a no-op (no query, no lifecycle events), and a dirty one emits a partial SET carrying the dirty keys only. New Eloquent-style instance methods `isDirty(key?)`, `getDirty()` and `wasChanged(key?)` report pending and last-written changes. Dirty saves never walk the graph (relationships stay on the explicit relate/detach paths), the primary key is treated as identity rather than state, and projected read-model properties are never written.
