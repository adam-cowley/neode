---
'neode': minor
---

**BREAKING** — `merge()` and `mergeOn()` now resolve to a merge-outcome wrapper instead of the bare hydrated entity: `{ entity, created, updated, counts, summary }` (NTS-630).

- `created` — the MERGE created the node (derived from the write counters)
- `updated` — it matched an existing node and wrote to it; both false on a no-op merge
- `counts` — destructurable write counters: `{ nodes, relationships, properties }` (properties counts SET operations)
- `summary` — the raw driver summary, preserved for power users

Also: `mergeOn()` joins the `INeode` port and is mirrored on `TransactionalService` (previously facade-only); `NODE_MERGED` is no longer reserved — it fires for every merge with the hydrated entity; `Repository#upsert` still returns the entity (it unwraps the wrapper).

Pre-1.0 note: shipped on the 1.0.0-next channel — the return-shape break lands in a minor bump accordingly. Destructure `const { entity } = await neode.merge(...)` where old code held the entity directly.
