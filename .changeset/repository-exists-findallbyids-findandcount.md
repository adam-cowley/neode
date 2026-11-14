---
'neode': minor
---

Three Repository read additions, plus one schema-probe combination:

- `Repository#exists(id)` — a bare primary-key existence check (`RETURN 1 LIMIT 1`): no projection, no hydration, read filters applied. Use it where `find()` would hydrate the full projected read-model (eager `@RelatedMany` included) only to be discarded for an existence answer.
- `Repository#findAllByIds(ids, { order?, limit?, withoutFilters? })` — one `WHERE this.pk IN $ids` read instead of one `find()` per id; projected models hydrate through the same RETURN map projection as `findAll()`.
- `Repository#findAndCount(filter, options)` — `findAll()` + `count()` as one call returning `{ items, total }` (the repository form of the facade's `findManyAndCount`); on a transaction-scoped repository both reads share the transaction's snapshot.
- `inspectSchemaAndDrift(connection, options)` — returns `{ inspection, drift }` from the one schema probe `schemaDrift()` already performs, so callers needing both payloads no longer inspect twice. `schemaDrift()` is unchanged.
