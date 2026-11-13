---
'neode': patch
---
`mergeMany()` now converts match keys through the model schema (NTS-637). Match keys were validated but written raw into the MERGE pattern, so a typed merge key arriving as a string — exactly what CSV/JSON sources deliver — never matched the stored temporal/typed value and silently duplicated nodes on every re-run. Match keys now run the same `convertPropertyValue` pass as set values; string/UUID merge keys are unaffected.
