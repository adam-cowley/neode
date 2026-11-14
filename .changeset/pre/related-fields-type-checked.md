---
'neode': patch
---

`@RelatedOne` / `@RelatedMany`: when `target()` is provided, `fields` is now type-checked against the target's instance type — a typo'd field name is a compile error instead of a field silently missing from the projection (the error message lists the valid fields). Calls with `fields` but no `target()` keep the unchecked `string[]` form, and omitting both `fields` and `target` is now also caught at compile time (it previously only threw at hydration time). Pair the decorator with `Pick<Target, ...>` on the annotated property so the DTO shape and the `fields` list can't drift apart.
