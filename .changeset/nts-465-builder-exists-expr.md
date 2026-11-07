---
'neode': minor
---

Builder gains `existsExpr(build, imports?)`: the `EXISTS { … }` subquery as a composable expression for the positions `whereExistsSubquery` cannot reach — nested inside `or()` chains (`or(builder.existsExpr(…))`), negated (`` `NOT ${builder.existsExpr(…)}` ``) and projected in RETURN. Sub-query values bind as parameters and namespace (`sub0_`…) exactly like the clause form, and unbound `$references` fail fast at build time. `whereExistsSubquery` is now a thin wrapper over the new method (NTS-465).
