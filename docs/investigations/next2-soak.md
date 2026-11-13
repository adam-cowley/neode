# Soak log — 1.0.0-next.2 in real consumers (NTS-677)

Soak of the [1.0.0-next.2 release](https://github.com/adam-cowley/neode/releases/tag/v1.0.0-next.2)
tarball (npm publish intentionally disabled) into two real consumers, on soak branches.
Release artifact: `neode-1.0.0-next.2.tgz` built from main `ed9a2d5` (the Version PR squash,
adam-cowley/neode#255).

| Consumer       | Kind                                                                                                              | How it consumed neode before                                                              | Soak branch                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------- |
| `graphacademy` | CJS (`module: commonjs`), `tsc` strict, vitest (unit + integration)                                               | `"@neode/beta": "link:../neode-ogm-stable"` (pnpm alias → the neode package), 113 imports | `soak/nts-677-graphacademy` |
| `northwind`    | ESM/NodeNext, very strict flags (`exactOptionalPropertyTypes`, `erasableSyntaxOnly`), vitest (unit + integration) | `"neode": "link:../neode-ogm-nts-664"`, 50 root imports + 1 `neode/express`               | `soak/nts-677-northwind`    |

Method: replace the `link:` dep with `file:vendor/neode-1.0.0-next.2.tgz` (downloaded from
the GitHub release), install, run each consumer's own typecheck / build / test suite.
Real-server smoke: `neo4j:5-community` Docker container (with the APOC plugin) on
`bolt://localhost:7688`.

**Every suite was also run against the consumer's pre-soak dependency as a control** —
the pass/fail diff against that baseline is what attributes failures to next.2.

## Results

| Consumer     | typecheck                                                                                                              | build             | test (vs baseline)                                                                                                                                                | Real-server smoke                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| graphacademy | ✅ after 1 rename fix (13 errors → 0)                                                                                  | ✅                | 539 pass / 17 fail — **all 17 identical to the old-link baseline** (pre-existing Neo4j 5 Cypher incompatibilities in consumer queries); **0 next.2-attributable** | smoke.ts ✅ + full suite against the real server (the numbers above)                                                                                      |
| northwind    | 12 pre-existing errors (missing APIs, NTS-685 — fails identically on its pinned checkout today; 0 in soak-branch code) | ✅ esbuild + vite | 96 pass / 16 fail — baseline was 17 fail; **0 next.2-attributable after 2 test-drift fixes**                                                                      | ✅ boot + `installSchema()` + wipe/seed (830 orders, 2155 lines) + health/ontology/schema/product/analytics/orders all 200 on Bolt; catalog 500 = NTS-685 |

## Findings

### F1. Release pipeline cannot ship — NTS-684 (blocks stamping 1.0.0)

The Version PR could not merge and never stamped a release. Three defects: lint fails on
the bot-generated CHANGELOG.md (biome formatting); `changeset-status` fails on any Version
PR by design; the merged `release` job's `create-github-releases` is inert without a
`publish-script` (no tag, no release — v1.0.0-next.2 was tagged/published **by hand**).
Unblock applied on the bot branch (formatted CHANGELOG + `changeset-release/*` job skip,
which rode into main with the squash); durable fix tracked in NTS-684 (+ PR #259).
Also: branch protection required a renamed-away check (`integration (latest)`) — updated
to the new matrix names; and bot-branch CI runs sit in `action_required` until approved.

### F2. northwind is blocked on unmerged, uncommitted library WIP — NTS-685 (blocks 1.0.0)

northwind calls `Repository#exists`, `#findAllByIds`, `#findAndCount` and
`inspectSchemaAndDrift` — none on any merged surface. The implementation exists only as
**uncommitted working-tree changes in the `neode-ogm-stable` checkout** (26 dirty files,
changeset included). On next.2: the server cannot boot (top-level import of the missing
export), the flagship order-flow fails at runtime (`(intermediate value).exists is not a
function`), `/api/catalog` 500s, and typecheck fails with 12 errors — all pre-existing on
the consumer's own pinned checkout, but equally true against 1.0.0-next.2. **The one
surface blocker for the GO/NO-GO.**

### F3. MIGRATION.md gaps hit by real consumers — NTS-686 (doc gap, pre-1.0 fix)

`batch`→`runAll` rename absent; pre-formed pattern fragments now rejected
(`Invalid alias` — the `whereProps` / `RawExpression` replacements undocumented; 7 call
sites broke in graphacademy); anonymous `.to('')` rejected; the merged REST contract
(node-models-only ontology, `issues`-not-`details` 422 body) undocumented — northwind's
tests drifted on both; APOC server requirement for the `expr` apoc helpers undocumented.

### F4. Retraction

An earlier draft of this log suspected the `neode/express` subpath was missing from the
published surface — wrong: main exports `./express` (NTS-664 merged as #330) and the
tarball ships `dist/express/*`. northwind's express twin works on next.2 (6/6 tests after
the drift fixes in F3).

## Consumer-side fixes made on the soak branches

**graphacademy** (`soak/nts-677-graphacademy` — pushed):

- `Neode#batch` → `runAll` (1 site)
- 7 pre-formed fragment sites → structured Builder: `.match(a, l)` + `.whereProps(...)`,
  `.merge(a, l, { k: new RawExpression('ref') })` across 3 files
- 2 anonymous `.to('')` → named aliases

**northwind** (`soak/nts-677-northwind` — pushed):

- express-api test drift: ontology expects node models only; 422 body reads `issues` (2 fixes)
- boot check / seed CLI pass auth from `NEO4J_USERNAME`/`NEO4J_PASSWORD` (previously
  probed with no credentials — could never reach an auth-enabled server)
- seed `--fresh` passes `{ confirm: true }` to `wipe()` (NTS-578 guard)
- `/api/schema` rewritten over `inspectSchema` + `schemaDrift` (two probes) — interim
  until NTS-685 lands `inspectSchemaAndDrift`
- `neo4j-driver@^6` added to dependencies (1.0 peer-dep obligation, MIGRATION.md §3)

## Environment notes

- Real server: `neo4j:5-community` + APOC plugin (`NEO4J_PLUGINS='["apoc"]'`), Bolt on
  localhost:7688. Without APOC, 36 additional graphacademy failures (`apoc.coll.toSet`)
  — consumer queries legitimately use the `expr` apoc helpers.
- northwind's own vitest integration project runs on the embedded Relate engine
  (`RELATE_LIB` / `RELATE_CLIENT_PATH`); the real-server smoke was a separate seed +
  serve + curl pass with `NEO4J_URI` set.
