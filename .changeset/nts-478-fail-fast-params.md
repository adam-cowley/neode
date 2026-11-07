---
'neode': patch
---

Query Builder: a raw `$name` inside a `call()` / `forEach()` / `countSubquery()` / `collectSubquery()` / `whereExistsSubquery()` callback that is never registered on the sub-builder now throws a `NeodeError` naming the offending fragment when the query compiles, instead of silently rewriting the reference into an unbound `$subN_name` that only failed at execution with `Neo4jError: Expected parameter(s): subN_name` (NTS-478). Register sub-query values with `sub.param(name, value)`; `$`-shaped text inside string literals and backtick-quoted identifiers is never mistaken for a parameter.
