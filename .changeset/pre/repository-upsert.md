---
'neode': patch
---

Adds `Repository#upsert(properties)` (TypeORM parity): create-or-update in one statement — MERGE on the model's merge fields (unique / indexed properties), SET everything else, return the hydrated entity. Guards both failure modes of an unguarded MERGE: a model with no merge fields, and properties carrying no merge field to match on, throw instead of silently creating a node per call. `merge` joins the `INeode` scope (implemented by the facade and `TransactionalService`), so `upsert()` also works through custom repositories inside an open transaction — where validation, defaults, server-side timestamps and `@Version` bumps all apply, because the statement runs through the regular merge path.
