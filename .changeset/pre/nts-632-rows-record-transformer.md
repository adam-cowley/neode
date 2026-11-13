---
'neode': minor
---

Ergonomic raw-row consumption (NTS-632). `rows(output)` maps a raw `QueryOutput` to plain objects keyed by column name, values passed through `jsonSafe` — the end of the `.get()`-cast plumbing. `CypherOptions.recordTransformer` (also on the `read()`/`write()` sugar) maps each record before it reaches the caller, its return replacing the row; ignored when `hydrate` is set (hydration owns the rows). The querying docs gain the row-consumption recipe — rows(), the scalar pattern (`rows(output)[0]?.n`), hydrate/toCollection, jsonSafeRecord — and the one-statement-over-id-polling rule (lists load via `with`-specs on the root read, never per-instance `load()` in a loop).
