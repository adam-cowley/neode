---
'neode': minor
---

Graph type drift as a first-class schema family (NTS-550): `schemaDrift()` probes `SHOW CURRENT GRAPH TYPE` and diffs the installed canonical specification against the model-derived definition per element — missing element types report an `ALTER CURRENT GRAPH TYPE ADD` fix, stale ones an `ALTER CURRENT GRAPH TYPE DROP`, redefined ones an `ALTER CURRENT GRAPH TYPE ALTER` — and `formatSchemaDrift()` renders the family. On backends without graph type support the family is omitted (drift stays cheap and never-throws). `wipe()` now resets the graph type to empty first (`ALTER CURRENT GRAPH TYPE SET { }`, best-effort): graph-type-derived constraints only go with the type. Exports `parseGraphTypeSpecification()` and `currentGraphType()`.
