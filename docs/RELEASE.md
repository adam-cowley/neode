# Release checklist

## 1. Package name — DECIDED

The package ships as **`neode`** (unscoped). Decided by Adam, 13 Nov 2026 —
the pending `@neode/ogm` option is dropped. No rename is planned; if one ever
happens, update `package.json` `name`/`repository`/`bugs`/`homepage` and
re-run the verification in §4.

## 2. Versioning (changesets — never hand-edit `version`)

Versions are managed by changesets; the `version` field in `package.json` is
written by the Version PR, not by hand.

1. Add a changeset for every user-visible change (`pnpm changeset`). The CI
   `changeset-status` job fails PRs that ship a user-visible change without
   one.
2. The package is in **pre mode** with the `next` tag
   (`.changeset/pre.json`); current line is `1.0.0-next.x`. See §8.

## 3. Gates (all must pass)

| Gate                  | Command              |
| --------------------- | -------------------- |
| Types                 | `pnpm typecheck`     |
| Lint (ESLint + Biome) | `pnpm lint`          |
| Unused exports/deps   | `pnpm knip`          |
| Full test suite       | `pnpm test`          |
| Coverage thresholds   | `pnpm test:coverage` |

CI runs these in three jobs: `lint` (`pnpm lint` + `pnpm knip` + a stale
`AGENTS.md` check via `pnpm docs:agents --check`), `check`
(`pnpm typecheck` + unit coverage + build/package checks over Node 22 and 24)
and `integration` (Testcontainers Neo4j). Run `pnpm lint && pnpm typecheck
&& pnpm test` before every commit (house rule).

## 4. Build & package verification

1. `pnpm build` — tsdown must succeed.
2. `pnpm test:package` — imports the built `dist/` (ESM **and** CJS), so it
   must run after the build.
3. `pnpm check:package` — `publint` + `attw --pack . --profile node16`.
4. `npm pack --dry-run` — the tarball must contain everything in the
   `files` field: `dist/**`, `llms.txt`, `llms-full.txt`, `AGENTS.md`,
   `docs/agent/**`, `skills/**`, plus the always-included `package.json`,
   `README.md` and `LICENSE`.
5. Optional smoke test: install the packed tarball into a scratch project and
   confirm `import Neode from 'neode'` resolves and a decorated class
   registers.

## 5. Coverage thresholds

`vitest.config.ts` floors at **71%** lines / **75%** functions / **84%**
branches / **71%** statements over `src/**`. The ratchet is calibrated
against the unit-project CI run (`pnpm test:coverage --project unit` — the
embedded backend's native library is unavailable in CI, so CI coverage
measures the unit project only). The full suite measures higher: ~89.9%
lines / ~92.0% functions.

## 6. Build output

tsdown builds **dual ESM + CJS** from the same sources:

- `dist/index.mjs` + `dist/index.d.mts` (ESM) and `dist/index.cjs` +
  `dist/index.d.cts` (CJS), wired through the `exports` map (`import` /
  `require` conditions); `"type": "module"`.
- `dist/bin/neode-generate.{mjs,cjs}` — the `neode-generate` bin.
- Runtime support is `engines.node >=20`; the build toolchain itself needs
  Node 22+ (CI builds on 22 and 24).

Both formats are verified by `pnpm test:package` and `pnpm check:package`
(§4).

## 7. Known gaps at release

The canonical, maintained list lives in the README's **Limitations**
section (added by NTS-673) — read that; this file deliberately does not
duplicate it.

## 8. Release flow

- **Changesets in pre mode** (tag `next`). Version bumps fold into a
  **Version PR** (`changeset-release/main`): run `pnpm changeset version` on
  that branch and open the PR (the CI-side Version PR job was removed with
  the release rework — NTS-581). CI skips the `changeset-status` job on
  `changeset-release/*` branches — "no changesets left" is the Version PR's
  normal state — and `CHANGELOG.md` is excluded from `biome format` because
  the changesets bot regenerates it unformatted.
- **Merging the Version PR releases automatically** (NTS-684): the `release`
  job in `.github/workflows/release.yml` gates the merge commit (`pnpm lint`
  + `pnpm typecheck` + `pnpm test:unit`), publishes to npm with
  `changeset publish` (pre mode → the `next` npm dist-tag; already-published
  versions are skipped) and then creates the `v<version>` tag and the GitHub
  release with generated notes — pre-release versions are marked as GitHub
  prereleases. Pushing a `v*` tag by hand releases that commit the same way.
- **npm auth comes from the `NPM_TOKEN` repo secret** (setup-node's
  `registry-url` writes the `.npmrc` npm reads). Publishing is wired but
  gated on that secret: until it lands, the publish step fails after the
  gates and the tag + GitHub release do not go out.
- `pnpm release` (`pnpm build && changeset publish`) is the local publish
  path for when a manual publish is needed. Any manual `npm publish` is
  guarded locally by `prepublishOnly`
  (`npm run build && npm run test:unit`).
- **Exiting pre for 1.0**: run `pnpm changeset exit pre`, then merge the
  next Version PR — it folds every accumulated `next` pre-release into the
  stable `1.0.0` release.
