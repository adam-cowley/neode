---
'neode': minor
---

Build-and-run sugar on every scope (NTS-553): `neode.read(builder)` / `neode.write(builder)` build a `Builder` once and run it through `readCypher`/`writeCypher` (READ/WRITE routing), while `neode.read('MATCH …')` passes a raw string straight through. Caller-supplied parameters merge over the builder's own params. Mirrored on the `INeode` interface, so `tx.read(...)` / `tx.write(...)` inside `inWriteTransaction` run in the transaction's scope.
