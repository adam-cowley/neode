---
'neode': patch
---

Query Builder: `statement(prefix)` now flushes the open where clause into the outgoing statement segment, like `match()` / `with()` / `create()` / `merge()` do — a pending `WHERE` no longer leaks into the following segment and renders after the wrong clause (NTS-479).
