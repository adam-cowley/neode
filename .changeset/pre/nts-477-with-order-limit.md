---
'neode': minor
---

Query Builder: `withOrder(...)` / `withLimit(n)` attach ORDER BY / LIMIT to the preceding `WITH` clause (NTS-477), expressing a mid-query sort before a write — `WITH u, e, c` / `ORDER BY coalesce(e.updatedAt, e.createdAt) DESC` / `LIMIT 1` / `SET e:…`. They accept the same argument forms as `orderBy()` and throw when no `WITH` is the last clause; plain `orderBy()` / `limit()` keep their RETURN-position behaviour.
