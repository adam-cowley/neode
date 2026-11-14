---
'neode': minor
---
Every write path now runs the observer/event lifecycle (NTS-596) — `update()` emits `NODE_UPDATED`, `mergeOn()`/`merge()`/`Repository#upsert`/`mergeMany()` emit `NODE_MERGED`, `createMany()` emits `NODE_CREATED` per row, `deleteAll()` emits `NODE_DELETED` per deleted entity, and the label writes (`addLabel()`/`removeLabel()`/soft delete) emit `NODE_UPDATED`, all after the commit with hook errors surfacing afterwards but never suppressing emission — and observers are now scoped per Neode instance (`neode.observe()`), with `extend()` models firing their base model's observers.
