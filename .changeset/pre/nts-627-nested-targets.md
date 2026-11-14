---
'neode': minor
---

Nested relationship targets on the write paths (NTS-627). `create()`, `merge()` and `save()` now accept, per DECLARED relationship key, an entity instance or a primary-key value: `create(Submission, { id, membership: '<uuid>' })`. Primary-key values relate EXISTING targets in the root CREATE statement — one round trip for node + edges (the two `find()` calls that existed only to feed `relate()` disappear); a missing primary key fails loudly naming the relationship key and value. Entity instances keep the recursive create walk; the edge is always MERGEd, so a save() round-trip never duplicates an edge. Undeclared keys on a create/merge property map now throw naming the key and the fix (they were silently dropped before). Composes with NTS-615's `options.relate` (which relates saved targets in-transaction) and NTS-628's `relationshipProperties` carrier for edge properties.
