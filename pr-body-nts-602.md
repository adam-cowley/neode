api: re-export all doc-taught symbols (RelationshipEdgeRead et al.) (NTS-602)

Closes https://linear.app/neo4j/issue/NTS-602 (child of NTS-590). Follow-up to NTS-600 (curation) and NTS-601 (first four re-exports).

## What

A sweep of every symbol the hand-written docs mention as consumer-facing (README.md, MIGRATION.md, docs/api-reference.md, docs/migration-guide.md, docs/migration-notes.md, docs/decisions/*, plus the hand-written prose of the generated AGENTS.md / llms.txt / llms-full.txt) against the export list of `src/index.ts` and `src/internal.ts` found six doc-taught symbols the package root does not export. All six are now re-exported from the root, next to their module peers. No signatures changed, nothing was removed from the curated surface — this only closes the gap where the docs teach a type a consumer cannot import (the known trigger: `RelationshipEdgeRead<T>`, the return shape of related reads, surfaced while applying the curated surface to the flagship demo).

## Re-exported symbols and where the docs teach them

| Symbol                    | Kind | Doc teaching it                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RelationshipEdgeRead<T>` | type | docs/decisions/0003-result-shapes.md — named twice as the result-shape contract ("`shapeEdgeRows` — `{ node, edge }` rows (NTS-499's `RelationshipEdgeRead`)", "The shape types themselves (`ScoredEntity`, `RelationshipEdgeRead`)"); the taught return shape of the related reads (NTS-566): `RelationshipEdgeRead<T>[]` for a many-key, `RelationshipEdgeRead<T> \| undefined` for a one-key                                 |
| `LoadedEntity`            | type | docs/decisions/0003-result-shapes.md shape table ("`find` / `all` / `findAll` with `with` spec → `LoadedEntity<…>` — nested exactly as the spec declares") and docs/decisions/0002-typing-eager-loads.md ("`LoadedEntity<T, W>` narrows the returns of `find` / `all`")                                                                                                                                                         |
| `ManyAndCount<T>`         | type | docs/decisions/0003-result-shapes.md shape table ("`findManyAndCount` → `ManyAndCount<T>` = `{ items, total }`")                                                                                                                                                                                                                                                                                                                |
| `SchemaResult`            | type | docs/api-reference.md — the documented return of `installSchema()` / `dropSchema()` ("`SchemaResult[]`: `{ action, type, label, property, statement, success, error? }`"), of the index services' `.create()` / `.drop()`, of the facade's `installFulltextIndexes()` / friends, and the per-statement report of `applySchemaDrift` (same WipeReport precedent from NTS-600: a documented method's named return type is public) |
| `DeleteOptions`           | type | docs/api-reference.md — named in the facade delete signature: `neode.delete<T>(entity, options?: DeleteOptions \| string, database?)`                                                                                                                                                                                                                                                                                           |
| `PropertySchema`          | type | docs/api-reference.md — the return type of `Repository#getPrimaryKey` in the repository methods table                                                                                                                                                                                                                                                                                                                           |

## Policy line applied (NTS-600 precedent)

Public = the docs teach it as consumer-facing. The load-spec **input** types (`QueryLoadSpec`, `QueryLoadLevel`, `LoadOptions`, `LoadSpec`, `WithSpec`, `ReadOptions`, `InstanceLoadLevel`, `FindManyAndCountOptions`) stay internal — NTS-600 reviewed those decision-record mentions and ruled them plumbing (consumers write specs/options as literals, the WipeOptions precedent). Every symbol this PR re-exports is a **result shape** or a type **named in a documented signature** — the thing a consumer receives and needs a name for. Symbols appearing only in generated listings stay internal.

## Tests

- `test/types/export-surface.test-d.ts` — the exact-match export-surface type test updated to the new exact type surface (value surface unchanged: all six are type-only exports), plus compile-level shape assertions for the re-exported types (`RelationshipEdgeRead`, `ManyAndCount`, `LoadedEntity`, `SchemaResult`, `DeleteOptions`).
- Generated agent docs (AGENTS.md, llms-full.txt, docs/agent/*) regenerated with `pnpm docs:agents` so the listings mirror the new root exports.
- Changeset: `.changeset/re-export-doc-taught-types-nts-602.md` (minor).

## Verification

`pnpm lint` ✓ · `pnpm typecheck` ✓ · `pnpm test` (183 files / 1920 tests) ✓ · `pnpm knip` ✓
