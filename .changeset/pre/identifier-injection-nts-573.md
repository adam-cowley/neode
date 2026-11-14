---
'neode': patch
---
Security (NTS-573): close Cypher identifier injection. Undeclared keys in `upsert()` / `mergeOn()` set maps, order fields (`all()`, `paginate()`, `load()`, `related().orderBy`, projection nested filters and sorts) and relation property keys are now backtick-quoted; order directions must be `ASC` / `DESC`; `limit` / `skip` must be non-negative safe integers; traversal `degrees`, `orderBy()`, `countDistinct()` and `exclude()` aliases are validated; relationship types are escaped. Invalid input throws a `NeodeError` that names the fix.
