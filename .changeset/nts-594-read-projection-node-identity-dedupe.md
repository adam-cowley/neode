---
'neode': patch
---
Multi-hop projection reads dedupe repeated end nodes by node identity (elementId) instead of projected value — distinct nodes with identical fields all survive — and load-spec callbacks accept object-map `where` clauses, every `orderBy` argument shape, and `withoutFilters`.
