---
'neode': minor
---
Named read filters now compose beyond the standard read paths (NTS-614): `Builder#withFilters(model, alias?, options?)` appends a registered model's declared filter fragments (soft delete included) into the current WHERE segment and merges the filters' params, and `readFilterFragment()` with `ReadFilterOptions` is exported from the package root for hand-written Cypher.
