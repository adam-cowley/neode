---
'neode': patch
---
Adds `Repository#increment(entityOrId, property, by = 1)` (NTS-435): one server-side statement, `SET p.<prop> = coalesce(p.<prop>, 0) + $by`, returning the new value — safe under concurrency where a read-modify-write via `update()` would lose updates. The property must be a declared numeric property of the schema (its name is interpolated into the Cypher, so the declaration check is the injection guard), and the step is bound as a query parameter.
