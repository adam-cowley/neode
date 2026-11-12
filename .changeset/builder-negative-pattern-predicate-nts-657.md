---
'neode': minor
---
Negative pattern predicate on the Builder (NTS-657): `whereNotPattern(alias, type, direction?)` renders `WHERE NOT (alias)<-[:TYPE]-()` — "node with no such relationship" as a typed pattern predicate, the supported replacement for raw `whereRaw('NOT (…)-[:TYPE]-()')` strings and for the OPTIONAL MATCH + IS NULL idiom that silently mis-filters on the embedded engine.
