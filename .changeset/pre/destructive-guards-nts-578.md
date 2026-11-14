---
'neode': minor
---

Guard the destructive schema operations (NTS-578). **BREAKING:**

- `wipe()` now refuses to run unless called with `{ confirm: true }` (or with `NEODE_ALLOW_WIPE=true` set suite-wide). It also refuses a non-local `uri` (option, or `NEO4J_URI`) unless `allowRemote: true`, and verifies the connected database name when `database` is given. Add `{ confirm: true }` to existing `wipe(...)` calls. It deletes in batches (`CALL { } IN TRANSACTIONS`, falling back to a bounded `LIMIT` loop), only tolerates "unsupported syntax" errors (authentication and other failures now throw), and returns a `WipeReport` (nodes deleted, graph type reset, dropped and failed constraints/indexes) instead of `void`.
- `installGraphType()` / `GraphTypeService.create()` no longer replaces the server's whole graph type: by default it only `ADD`s the missing element types and constraint items and reports differing definitions as failed results, leaving other applications' objects on a shared database alone. The old `ALTER CURRENT GRAPH TYPE SET` behaviour is opt-in with `replace: true`, which is refused when it would drop objects no registered model declares unless `canDropUndeclared: true` is also passed. The default statement is now `ALTER CURRENT GRAPH TYPE ADD { ... }`.
- `dropSchema()`, `dropGraphType()` and `applySchemaDiff()` docs now state that they act on the connected database.
