---
'neode': minor
---
UNION / UNION ALL: `builder.union()` / `builder.unionAll()` combine query branches — each branch ends in its own `return()` naming the same columns, and tail `orderBy()` / `skip()` / `limit()` after the final branch apply to the combined result. Branch parameters bind independently (collision-renamed, NTS-609 loop), no `WITH *` write→read bridge crosses a branch boundary, and both `union()` without a preceding RETURN and a query left ending mid-branch fail fast with `NeodeError` instead of reaching the database.
