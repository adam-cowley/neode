---
'neode': patch
---
`createMany()` / `mergeMany()` now resolve `fake` generators during row preparation (NTS-608), in the same order as single `create()` — fake, then transforms, then validation — so rows carrying only `fake` properties (including required ones) validate and write generated values instead of failing or writing the property as absent. Each row's generator runs independently: unique + `fake` properties are not guaranteed distinct across rows (use DB-safe generators such as random UUIDs) — the in-batch retry distinctness of the FactoryBuilder is not applied here.
