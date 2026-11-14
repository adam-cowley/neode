---
'neode': minor
---

Pagination extras (NTS-166): `neode.findManyAndCount(model, filter, options?)` returns every matching entity with its total in one call (`{ items, total }` — options trim the data read only, `total` always counts the whole filter); `neode.chunk(model, filter, size, callback, options?)` walks a large read in keyset pages, handing the callback each chunk in order (return false from the callback to stop early) and resolving to the number of items delivered; `neode.lazy(model, filter, options?)` is an async iterator over the same keyset walk, yielding one entity at a time so memory stays flat on large reads — breaking out of the `for await` loop stops the walk cleanly, with no session left open. Both walks default to keying on `createdAt`; pass `orderBy` to key on another property.
