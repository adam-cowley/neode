---
'neode': minor
---

`toJson()` accepts relationship serialisation options (NTS-564): `toJson(entity, { relationships: { include, exclude, depth } })` opts relationships in or out of the output and bounds how many levels serialise, without hand-picking properties. Unknown include/exclude keys throw the schema's descriptive error naming the valid relationships, and calls without options serialise exactly as before.
