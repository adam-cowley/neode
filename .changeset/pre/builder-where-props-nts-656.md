---
'neode': minor
---

Builder: property-to-property comparison predicates — `whereProps(left, operator, right)` compares two references (`alias` or `alias.property`, quoted identifiers, never parameters) and `whereInRefs(property, listRef)` tests membership against a collected list, both validated against the comparison-operator set and composable with `or()` / `whereGroup()`, so ref-to-ref predicates (`p.unitsInStock <= p.reorderLevel`, `other <> c`) no longer need `whereRaw` hand-strings.
