---
'neode': minor
---
`replaceRelationship()` now enforces the declared write-time cardinality (NTS-643): a multi-target replace on a `one` / `zeroOrOne`-declared relationship throws `CardinalityViolationError` naming the relationship, the declared cardinality and the fix — before any statement runs, the same contract as `relate()` and `syncEdges()` (NTS-161). Use `syncEdges()` semantics or declare the relationship as `many` when the replace legitimately holds several edges.
