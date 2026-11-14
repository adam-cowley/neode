---
'neode': patch
---
Security (NTS-585): node labels (`match()` / `create()` / `merge()` / `whereLabel` / `orderByLabel` / bulk `labelPattern`), keyset cursor `orderBy` and filter keys, `withinDistance()` location properties, projection keys / field subsets and DDL constraint / index names are now backtick-quoted (label quoting is idempotent, so pre-quoted labels pass through unchanged), and the read-filter `node` alias rewrite no longer touches `x.node` property names, `$node` parameters, `:node` labels or string literals.
