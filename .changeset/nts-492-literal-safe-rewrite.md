---
'neode': patch
---

Query Builder: the `$subN_` rewrite applied to `call()` / `forEach()` / `countSubquery()` / `collectSubquery()` / `whereExistsSubquery()` sub-queries no longer touches `$name`-shaped text inside string literals or backtick-quoted identifiers, so quoted text like `'%s is $label'` survives verbatim instead of being corrupted into broken Cypher with phantom unbound `$subN_label` parameters (NTS-492).
