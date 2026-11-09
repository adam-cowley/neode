Closes NTS-595 — https://linear.app/neo4j/issue/NTS-595 (child of NTS-587)

## What

Write-path delete semantics, per the maintainer-decided contracts:

1. **Annotated-only cascade (default).** `delete()` cascades only into relationships explicitly annotated `cascade: true`; un-annotated relationships are **detached, not deleted** — their target nodes survive. `{ cascade: true }` / `{ cascade: false }` still override per call. _(This default already landed on main via #231; this PR documents it as an intentional pre-1.0 breaking change and locks it with tests.)_
2. **Cascade depth cap.** The self-referential cascade walk is capped by the exported `MAX_CASCADE_DEPTH = 10` (mirrors `MAX_TRAVERSE_DEPTH` from NTS-593 in value/style/location — root export, doc comment, per-call option). Overridable per call with the `depth` option.
3. **Node-only soft delete, idempotent.** The `@SoftDelete` path emits a label-gated statement (`WHERE NOT this:<label>`), so a repeat soft delete is a **no-op** — `deletedAt` is never re-stamped. No cascade clauses are emitted; relationships are untouched; label removal is what hides the node.
4. **`deleteAll()` guard.** `deleteAll()` / `deleteAll({})` now **throws** with a fix hint (NTS-578 destructive-guards precedent): pass at least one filter, or `{ all: true }` to confirm the fast bulk wipe. Filtered calls proceed unchanged. Applied to both `Repository.deleteAll` and `Neode#deleteAll`.
5. **Row-multiplication fix.** The cascade walk's chained `OPTIONAL MATCH`es cross-multiplied rows: sibling cascade segments joined as a product (`rows(seg A) × rows(seg B) × …`), so wide/deep graphs blew the statement up exponentially. Each frame now re-states only the alias chain its remaining clauses reference, with `WITH DISTINCT` collapsing the previous frame's fan-out — statement work is the max fan-out of any single frame, not the product.

## Breaking changes (both maintainer-approved, pre-1.0)

- Un-annotated relationships no longer cascade on delete — documented in **MIGRATION.md §6** with the `{ cascade: true }` opt-in.
- `deleteAll()` without filters throws — documented in **MIGRATION.md §6** with the `{ all: true }` opt-in.

Public API is otherwise additive: `MAX_CASCADE_DEPTH` export, `depth` option.

## Tests

- `test/unit/delete-cascade.test.ts` — Cypher-snapshot coverage: depth cap on a self-referential chain (10 hops by default, `depth` override), `WITH DISTINCT` alias-chain carry (no wide `WITH` lists), soft-delete gate + node-only statement, `MAX_CASCADE_DEPTH` value.
- `test/integration/delete-semantics-nts-595.test.ts` — real end-to-end scenarios on the test backend: annotated vs unannotated cascade on saved data, self-ref chain of 13 (11 deleted, tail survives), shared cascade targets (deleted once; second root's delete succeeds against the gone target), soft-delete idempotency (stamp unchanged on repeat, edges untouched), deleteAll guard (refuses → filtered subset → confirmed wipe).
- `test/integration/parity-shims.test.ts`, `test/integration/repository.test.ts`, `test/unit/repository.test.ts` — updated to the new `deleteAll` contract.

**What ran where:** full gate locally — `pnpm lint && pnpm typecheck && pnpm test` (175 files, 1812 passed) with the integration tests on the default embedded Relate backend (in-memory). No external Neo4j was needed; the CI container backend runs the same suite.

## Changeset

`.changeset/annotated-only-cascade-nts-595.md` — `minor` (breaking-behavior fixes pre-1.0, matching the NTS-578 minor precedent for breaking changes).
