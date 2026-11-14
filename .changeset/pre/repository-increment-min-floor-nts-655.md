---
'neode': minor
---
`Repository#increment` gains a `min` floor option (NTS-655): `increment(item, 'unitsInStock', -qty, { min: 0 })` renders the floor as a `WITH … WHERE` terminal in the decrement's own statement, under the write lock, so a post-write value below the floor (inclusive comparison) filters the statement's only row and throws the new `GuardViolationError` — the throw rolls a managed `inWriteTransaction` unit back, closing the check-then-decrement race consumers had to hand-roll in raw Cypher.
