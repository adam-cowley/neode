---
'neode': minor
---

Fluent build-and-run chains (NTS-554): `neode.query()` now returns a `BoundBuilder` — a `Builder` bound to the instance (everything the plain Builder has, plus `.read()` / `.write()` terminals that build-and-run through `Neode#read`/`Neode#write` with READ/WRITE routing), so a whole query reads as one chain: `await neode.query().match('o', 'Order').… .return('o', 'p').read()`. `tx.query()` does the same inside an open transaction, running in scope. A `database` argument on `query()` is forwarded to the terminals. The standalone `Builder` gains no implicit execution.
