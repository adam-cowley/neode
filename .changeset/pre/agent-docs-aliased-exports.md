---
'neode': patch
---

The agent-docs generator now extracts symbols exported through local alias lists (`export { expressions as expr }`), so the `expr` / `caseExpr` Cypher-expression helpers appear in AGENTS.md, llms.txt, the docs/agent pages and the skills pack — they are public API but were missing from every generated surface. The api-reference's projection section documents `@Expression` (raw Cypher with `this` as the root node, Relate's pattern-expression restriction, when to prefer `@Computed`) and `@LabelPresent` alongside the other projected-field decorators.
