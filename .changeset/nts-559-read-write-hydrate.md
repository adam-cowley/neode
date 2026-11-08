---
'neode': minor
---

Hydrate option on `neode.read()` / `neode.write()` (NTS-559): pass an options object — `{ hydrate: Model, alias?: 'o', database? }` — as the second argument (when there are no parameters) or the third, and the rows come back as hydrated entities of that class instead of raw records, the same overload shape `cypher()` offers. A Builder traversal that should return entities no longer needs the separate `hydrate()` call. Mirrored on the `INeode` interface and `TransactionalService` (in-transaction scope; the transaction mirrors take no `database`). The NTS-553 positional `(parameters, database)` shape is unchanged.
