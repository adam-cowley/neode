---
'neode': patch
---
Soft delete and named read filters now apply on the read paths that bypassed them: `traverse()` (origin, hop nodes and `runAggregates()` counts, with a new `withoutFilters()` / `traverse(model, { withoutFilters })` opt-out), `withinDistance()` (new trailing `filters` argument), the intermediate nodes of `path` projections, and nested filters on `@RelatedOne` / `@RelatedMany` (now an `EXISTS { }` subquery honouring the target's filters, so roots no longer duplicate and soft-deleted related nodes no longer satisfy a filter). A projected property's own `where` is now parenthesised so an `OR` cannot escape the read filters. `instance.related(key, { withoutFilters })` accepts the same opt-out as `load()`.
