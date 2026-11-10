---
'neode': patch
---

Documented the `cypher()` options-variable edge (NTS-617): a pre-built options variable annotated `CypherOptions` and carrying `hydrate` resolves to `Promise<QueryOutput>` even though the runtime hydrates — excess property checks only apply to object literals, and TypeScript cannot recover the hydrate class from the variable's annotation, so the type-level fix would break compiling raw calls. The docs now show the escape hatch (`{ hydrate: Model } satisfies CypherOptions` keeps the literal type, so the call resolves to `Promise<Model[]>`); type tests pin the resolved shapes.
