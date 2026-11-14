---
'neode': patch
---

Builder: pattern parameter names are now sanitised and de-duplicated (NTS-609). Two segments using the same alias and property key (e.g. `create('n', …, { name: 'a' })` then `merge('n', …, { name: 'b' })`) each bind their own parameter instead of the later value silently overwriting the earlier one, property keys with non-identifier characters produce valid parameter names, and a parameter slot holding `undefined` is no longer treated as free and reused.
