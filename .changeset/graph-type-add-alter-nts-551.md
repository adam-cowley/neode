---
'neode': minor
---

`extendGraphType()` / `alterGraphType()` (NTS-551): the two remaining graph type verbs — `ALTER CURRENT GRAPH TYPE ADD` adds new element types and constraint items to the installed graph type (only additions are valid server-side), and `ALTER CURRENT GRAPH TYPE ALTER` redefines existing element types. `alterGraphType()` defaults to the model-derived element types with their uniqueness stripped: key/uniqueness constraints cannot be altered and remain unchanged server-side (passing a definition that still carries them throws). Exports `graphTypeAddStatement()`, `graphTypeAlterStatement()` and `deriveGraphTypeElementsOnly()`.
