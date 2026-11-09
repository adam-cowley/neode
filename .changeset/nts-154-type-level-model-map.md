---
'neode': minor
---
feat(types): type-level model map + narrowed per-query with() returns (NTS-154)

Declare `declare static readonly neodeRelationships: { pets: true }` on a
model and the `with` load spec of find / all (facade and transactions)
checks its keys against the declared relationships — nested spec levels
included, property and unknown keys rejected — and the returned entities
narrow to `Person & { pets: (Pet & { toys: Toy[] })[] }`. Models without
the map fall back to the declared object/array field keys. The query
level now also accepts nested spec objects (`with: { orders: { toys: {
limit: 2 } } }`), rendered by the same single-statement machinery the
per-instance load spec uses. Findings and the remaining ceiling:
docs/decisions/0002-typing-eager-loads.md.
