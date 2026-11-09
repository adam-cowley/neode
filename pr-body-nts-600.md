api!: curate public export set, @internal the rest (NTS-600)

Closes https://linear.app/neo4j/issue/NTS-600 (child of NTS-590).

## What

The package root (`src/index.ts`) exported 211 named symbols plus a wildcard re-export of all 51 decorator symbols — the full accumulated surface, most of it never documented anywhere a consumer would read. This PR curates the intended public API pre-1.0 (`1.0.0-next`): the **documented surface stays exported, everything else is internal**.

- **200 symbols stay public**: 128 value exports (including `default`) + 72 type exports — the `Neode` facade (+ `INeode`), all decorators (wildcard), `Repository` + registry functions, the `Builder` cluster, map-API config helpers, the typed error taxonomy, and everything the hand-written guides teach (search, hydration, serialisation, ops & testing, ontology, factories, pagination/bulk services and their result types).
- **62 symbols internalized** (21 values + 41 types): graph-type machinery (NTS-549/550/551/578), `generateModels` (NTS-164), load-spec/related-read type plumbing (NTS-154/497/499/558/560), registry/service internals (`getModel`, `getModels`, `validate`, `SyncService`, `observe`/`clearObservers`, `requireRelateClient`, `vectorIndexName`, `fulltextIndexName`, `readFilterFragment`) and option types never named in the API reference (`TransactionOptions`, `HydrateQueryOptions`, `RelateConnectionOptions`, `ToJsonOptions`, `RelationshipSerialisationOptions`, `ReadFilterOptions`, `FilterDefinition`, `WipeOptions`, `WipeFailure`, `ValidationRules`, `RelationshipCardinality`, `InstanceLoadLevel`, `ModelObservers`, `ObserverContext`, plus the `GraphType*` / `Generated*` type families and the load-spec types).
- The internalized symbols moved to **`src/internal.ts`** (in-repo internal import surface; not a published subpath). No symbol body was touched — the diff is strictly the export lists plus doc regeneration.
- **Runtime behaviour unchanged**; the pre-1.0 **type surface narrowed to the documented API** (that narrowing is the point of the task). JS consumers of internalized symbols must move to the public replacements; TS consumers were already importing them only through the type surface, which no longer carries them.

## How the public set was determined (not guessed)

A symbol is public iff any of:

1. **The hand-written docs teach it** — README.md, docs/api-reference.md (its "full public surface" import block and every section), docs/migration-guide.md. All 133 symbols taught there stay public, so the hand-written docs remain exactly true with no edits.
2. **The maintainer's categories**: `Neode` class, decorators, repository, builder, config helpers.
3. **Recent maintainer-approved additions**: `setDeprecationWarnings` (NTS-599), `MAX_TRAVERSE_DEPTH` (NTS-593).
4. **Existing type tests assert the root export** — `SyncEdgesOptions` / `SyncEdgesResult` (nts-161.test-d.ts) and everything in migration-guide-snippets / nts-493 / api.test-d.ts.

Everything not covered by the four rules (never documented outside the generated listings, which mechanically mirror the export list) went internal.

## Judgment calls

- **Error taxonomy kept whole**: `CardinalityViolationError`, `RelationNotLoadedError`, `OptimisticLockError` are beyond the README's taxonomy row, but they are the documented taxonomy's family (AGENTS.md error section) and the errors of documented features — half a taxonomy would be worse than none.
- **Filter parameterisation kept public**: `setFilterParams` / `withFilterParams` / `clearFilterParams` / `WITHOUT_ALL_FILTERS` — the documented `@Filter` usage requires them (request-scoped params, NTS-575). The plumbing they drive (`readFilterFragment`, `ReadFilterOptions`, `FilterDefinition`) went internal.
- **Strict-relation switch kept public**: `setStrictRelationAccess` — the on-switch for the documented strict-relation behaviour (named by `RelationNotLoadedError`); same family as `setDeprecationWarnings`.
- **Traverse surface kept whole**: `TraverseBuilder`, `Hop`, `TraversalRow` alongside the explicitly approved `MAX_TRAVERSE_DEPTH` — `neode.traverse()` is documented, its class and row shapes are its types.
- **`RawExpression` kept public**: the documented Builder escape hatch for raw inline values (NTS-460).
- **`WipeReport` public, `WipeOptions`/`WipeFailure` internal**: the API reference names `WipeReport` as `wipe()`'s return; the options shape is passed as literals.
- **`SyncEdgesOptions`/`SyncEdgesResult` public**: existing type test (nts-161) imports them from the root.
- **`MAX_CREATE_DEPTH`**: not exported from the root today — stays unexported; no new surface added.
- **Graph-type + generateModels families internalized**: documented only in the generated listings (newer than the hand-written API reference); the maintainer can re-export them deliberately for 1.0 if wanted.

## Verification

- New exact-match type test `test/types/export-surface.test-d.ts`: asserts `keyof typeof import('neode')` equals the curated 128-name value set, and the 72-type public type surface is present — any future addition must be deliberate.
- `knip` green (`src/internal.ts` added to knip entries — it is the internal import surface), `tsc --noEmit` green, full unit suite (91 files / 1229 tests) + type project (17 files / 94 tests) green; pre-push hook runs build + lint + typecheck + the full suite.
- Generated docs regenerated with `pnpm docs:agents` (AGENTS.md, llms.txt, llms-full.txt, docs/agent/*, skills/neode/SKILL.md) — the generated listings now mirror the curated set.
- Changeset: `.changeset/curate-public-export-set-nts-600.md` (minor; notes the pre-1.0 type-surface narrowing).
