---
'neode': patch
---
`cypher()` overload fix (NTS-616): the raw overload now resolves to `Promise<QueryOutput>` on every scope (a raw call on the transaction scope previously fell into the hydrate overload and came back typed `Promise<unknown[]>`, forcing consumers to cast `records`), and the hydrate overload now resolves to `Promise<T[]>` on the facade and `INeode` (previously shadowed by the raw overload, whose options bag subsumed it, so hydrate calls were typed as raw output). Overload declarations only — no runtime change.
