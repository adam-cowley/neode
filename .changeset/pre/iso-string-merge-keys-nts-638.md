---
'neode': patch
---
Bulk merge keys on iso-string timestamp properties match the string form (NTS-638): `mergeMany()` match keys and `rowToProperties()` conversion now leave string values unconverted when the property declares `{ format: 'iso-string' }` (NTS-612) — those properties store the string rendering, and a converted temporal match value never equalled it, silently duplicating nodes on every re-run (the iso-string sibling of NTS-637). Supplied non-string values still convert normally.
