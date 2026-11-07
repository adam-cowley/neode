# Release checklist (P8.4)

## 1. Package name — DECISION PENDING

The package currently publishes as **`neode`**. Before the first stable
release, pick the final name:

- `@neode/ogm` — scoped, keeps the `@neode` org namespace (recommended)
- `neode 1.0` — unscoped, clearer standalone discovery on npm

Changing the name means: update `package.json` `name`, `repository`/`bugs`/
`homepage` URLs if the repo moves, and re-run the verification in §4.

## 2. Version bump

1. Update `version` in `package.json` (semver; use `npm version` if preferred).
2. `npm run build` — must succeed with no type errors.

## 3. Gates (all must pass)

| Gate                | Command                                     |
| ------------------- | ------------------------------------------- |
| Types               | `npx tsc --noEmit`                          |
| Lint                | `npx eslint src test`                       |
| Full test suite     | `npx vitest run` (559+ tests green)         |
| Coverage thresholds | `npm run coverage` (80% floors — see below) |
| Package sanity      | `npm pack --dry-run` (dist + types only)    |

`npm publish` is additionally gated by the `prepublishOnly` script
(`npm run build && npm run test:unit`), so a failed build or unit test aborts
the publish locally and in CI.

## 4. Verification steps

1. `npm pack --dry-run` — confirm the tarball contains only `dist/**`
   (`.js`, `.d.ts`, `.d.ts.map`, `.js.map`), `package.json` and `LICENSE`/`README`.
2. Install the packed tarball into a scratch project and check that
   `import Neode from 'neode 1.0'` (or the scoped name) resolves and the
   decorators register an entity.
3. Push a tag `v<version>` to run the CI `release` job. The job is inert
   unless the `NPM_TOKEN` secret is configured (repo Settings → Secrets →
   Actions); it runs build → unit tests → `npm publish` on Node 22.

## 5. Coverage thresholds

`vitest.config.ts` floors at **80%** for lines, functions, branches and
statements over `src/**` (baseline Nov 2026: ~89% across the board).
Thresholds are enforced on the full-suite `coverage` run; unit-only runs are
not thresholded because most `src/services/**` code paths are exercised by the
integration project.

## 6. ESM dual build — DEFERRED to a follow-up

**Verdict: CJS-only for v1.** Rationale (verified):

- With `module: nodenext` and `"type": "module"` (the only way to get true ESM
  output), tsc fails immediately with **TS2835** — every extensionless
  relative import across ~96 `src/**/*.ts` files needs an explicit `.js`
  extension. That is a mechanical but wide rewrite of the source.
- Bypassing the check would emit ESM that plain Node cannot resolve
  (`ERR_MODULE_NOT_FOUND`): tsc never rewrites import specifiers.
- The rewrite also carries resolution risk in the test toolchain
  (vitest + `unplugin-swc` must resolve `.js` specifiers back to `.ts`).
- Dual-format output additionally requires separate `dist/cjs` and `dist/esm`
  trees plus a two-arm `exports` map (`import`/`require`), and a format marker
  per tree — none of which is worth gambling the first release on.

**Follow-up path:** add `.js` extensions to relative imports → dual
`tsconfig.json` / `tsconfig.esm.json` (`module: nodenext`, separate `outDir`) →
`exports` map with `require` and `import` conditions → verify with vitest and
a runtime smoke test in both formats.

## 7. Known gaps at release

- **Relate FFI** cannot receive driver `Temporal`/`Point` parameters.
- **Relate engine bug**: `DELETE` inside an explicit transaction is incorrect.
- **Multi-database** support requires Neo4j Enterprise; round-trip tests are
  env-gated (`NEO4J_*` secrets) and not covered by the embedded backend.
- **Batch writes** execute sequentially, not in parallel.
