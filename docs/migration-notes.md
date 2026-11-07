# Migration Notes — neode-ogm (Phase 0 baseline)

Recorded on branch `refactor/modern-stack`, tagged `legacy-final` (commit `a58eaa3`, v0.2.0).
**Target of migration: this package (`neode`, `neode-ogm/`).** The legacy `neode/` package
is out of scope (a stray migration attempt there was parked on `refactor/modern-stack` in that repo
and can be discarded).

## What's already on the target stack (no work needed)

| Area                | State                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| Language            | TypeScript 5.9, `strict: true`                                             |
| Test runner         | Vitest 3, `unit` / `integration` projects, v8 coverage w/ thresholds (80%) |
| Driver              | `neo4j-driver` 6.x, Node >= 20 engines field                               |
| Validation          | Zod                                                                        |
| CI                  | `.github/workflows/ci.yml` exists (verify against Phase 6 matrix)          |
| Integration backend | Embedded Relate (default) + Neo4j/Memgraph via Bolt env vars               |

Baseline test run (this commit): **unit 627 passed (1.3s), integration 239 passed / 1 skipped (1.5s)** — all green.
Integration uses the embedded Relate engine (`test/integration/setup.ts`), no external DB required.

## Gaps (what this migration actually changes)

1. **Decorators**: `experimentalDecorators` + `emitDecoratorMetadata` + `reflect-metadata` + SWC
   vitest transform → **standard TC39 decorators** with `context.metadata`, `Symbol.metadata`
   polyfill at entry, no reflect-metadata, no SWC.
2. **Build**: `tsc` CJS-only → **tsdown dual ESM+CJS** with `dts`, `exports` map
   (import/require/types), `main`/`module`/`types` fields.
3. **Package manager**: npm → **pnpm** (+ `packageManager` field; keep `engines: node >=20`).
4. **Lint/format**: ESLint `recommended` + Prettier → ESLint **`strictTypeChecked`** +
   `stylisticTypeChecked` (type-aware, all linting) + **Biome formatter-only**; delete Prettier.
5. **Type strictness**: add `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
   `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`, `useDefineForClassFields`,
   `erasableSyntaxOnly`, `noUnusedLocals/Parameters`, `noPropertyAccessFromIndexSignature`,
   `noImplicitReturns`. Remove `strictPropertyInitialization: false`.
6. **Integration backend**: add **Testcontainers** (`@testcontainers/neo4j`) as a CI-selectable
   backend (`OGM_TEST_BACKEND=neo4j` + `NEO4J_IMAGE`), keep embedded Relate as local default.
7. **Packaging checks**: publint + attw, npm pack smoke test (ESM+CJS).
8. **Release**: Changesets + npm trusted publishing (OIDC), `next` pre-release first.
9. **Guardrails**: AGENTS.md, pre-push hook, knip.

## package.json surface (today)

- `name: neode`, `version: 0.2.0`
- `main: dist/index.js` (CJS from tsc), `types: dist/index.d.ts`
- `exports["."]`: types + default only (ESM-shaped — CJS consumers currently get ESM via
  `require` falling back? No: no `require` condition; CJS `require()` of this package resolves the
  default condition → dist/index.js as CJS? dist/index.js is CommonJS today (tsc module commonjs)
  with an ESM-style exports entry — publint would flag this. Dual build fixes it.)
- `files: ["dist", "!dist/tsconfig.tsbuildinfo"]`
- `sideEffects: ["dist/decorators/relationship/other-node.decorator.js"]`
- deps: `dotenv`, `neo4j-driver@^6`, `reflect-metadata` (to be dropped), `zod`
- devDeps: eslint 9 stack, prettier (to be dropped), `@swc/core` + `unplugin-swc` (to be dropped),
  `@types/node`, `@vitest/coverage-v8`, `typescript ~5.9`, `vitest`

## Public API inventory (src/index.ts)

- Default export: `Neode` (service class, `neode.interface.ts` defines the shape)
- Named: `EventType`, `fromEnv`, errors (`NeodeError`, `ConstraintViolationError`, `TransientError`,
  `classifyError`, `isTransientError`), `Repository`, `TransactionalService`,
  `registerRepository`/`getRepository`/`resolveRepository`, `mergeRelationshipProperty`,
  `Collection`, `toJson`/`valueToJson`, `applyEntityMethods`/`setDefaultNeode`,
  `defineModel`/`extendModel`/`getModelByName`/`getModelsByName`, `Builder`/`Direction`/`toDirection`,
  `hydrate`/`hydrateFirst`/`toCollection`, driver exports (`Neo4jConnectionProvider`,
  `RelateConnectionProvider`, `ConnectionProvider` type + query types), `jsonSafe`/`jsonSafeRecord`,
  `instrumentConnectionProvider`, projection exports (`ProjectionService`, `projectionNode`,
  `hasProjectedProperties`, `hydrateProjection`, ...), schema sync, events, testing helpers
  (see `src/index.ts` for the authoritative list — it is the single entry point)
- Decorators (`src/decorators/`): `@Node`, property decorators (`@Property`/typed property
  decorators), relationship decorators (`@Relationship`/`@OneToOne`-style + `@OtherNode`),
  `@InternalId`, projection decorators, `@Repository`
- Types: `PropertyDefinition`, `RelationshipDefinition`, `SchemaDefinition`,
  `RepositoryConstructor`, `EntityMethods`, `WithMethods`, `QueryExecutedEvent`, projection types

## Characterization safety net

The suite is already comprehensive (866 tests incl. builder parity, golden Cypher parity,
hydration round-trips). Gap check during later phases:

- Cypher **snapshot** tests for every builder method — builder parity suite covers this; extend
  if any builder method lacks a pinned assertion.
- Type tests (`*.test-d.ts`) for inference — added in Phase 4.
