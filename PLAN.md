# neode-ogm — Master Build Plan

> **Status: Phases 0–8 complete (all 52 roadmap issues Done) + all 25 Wishlist issues Done.** Live tracking: Linear project `neode-ogm` (team NTS). This file is the design reference; the board is the state.
>
> Executed in **6 waves** of parallel subagents, dispatched strictly along the task-level dependency tree (blocked tasks never started):
>
> | Wave | Tasks                                      | Result                                                                                                      |
> | ---- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
> | 1    | P1.1, P1.2, P1.5, P2.2                     | metamodel types/options/labels, builder parity (66 tests, 2 builder bugs fixed)                             |
> | 2    | P1.3, P1.4, P2.1, P3.1–3.3, P4.2, P6.1–6.2 | map adapter, full decorator set, EagerUtils, Zod validation, mergeOn, schema sync                           |
> | 3    | P4.1, P4.3–4.9, P1.6, P6.3                 | all query services, multi-degree eager, Collection/toJson, golden parity (3 parity bugs fixed), round-trips |
> | 4    | P3.4, P4.10, P5.2, P7.1                    | validation on every write path, full facade + e2e example flow, fromEnv audit, repository surface           |
> | 5    | P5.1, P5.3, P5.4, P7.2, P7.3               | batch, multi-database, events, instance methods, repository registry                                        |
> | 6    | P8.1–8.4                                   | bench suites, docs + migration guide, packaging + release                                                   |
>
> After wave 6: **580 tests green** (unit + integration on embedded Relate), strict tsc + eslint clean, 89.5% coverage, release checklist in docs/RELEASE.md.
>
> **Wishlist waves** (graphacademy-driven, NTS-122–146), same discipline:
>
> | Wave | Issues                                                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
> | ---- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
> | W1   | NTS-122–128, 130, 132–138, 142–144, 146 (19 issues, 6 agents) | raw-cypher escape hatch + optional hydration, per-query routing, explain/profile, query:executed; projection decorators (RelatedOne/Many, RelationshipCount/Exists, LabelPresent, Computed, Expression) with one-query-per-read; schema inspect + fulltext/vector sync + search/knn; createMany/mergeMany; paginate (offset + keyset); verifyConnectivity, cypher script runner, wipe/testId; builder predicates + orderBy expressions + labels-as-state — **790 tests green** |
> | W2   | NTS-129, 131, 145 (3 agents)                                  | typed error taxonomy (constraint violation w/ parsed label+property, transient classification) wired at both providers; fromEnv driver-config passthrough; nested read-model filters/sort — **841 tests green**                                                                                                                                                                                                                                                                |
> | W3   | NTS-139, 140, 141 (1 agent)                                   | hydration defaults (null→undefined + coalesce), composite unique/index constraints, IS :: STRING property-type constraints — **866 tests green**                                                                                                                                                                                                                                                                                                                               |

Turning `neode-ogm` into a full-featured, decorator-first OGM for Neo4j with **feature parity with neode 0.4.9**, while **also supporting the classic map-based schema API**. Built test-first (red-green), with unit + integration suites and benchmarks.

## Decisions (agreed)

| Decision               | Choice                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Driver / server target | **Modern**: `neo4j-driver` 6.x, Neo4j 5.x / 2025.x servers, Node ≥ 20 (native `elementId`, no `neo4j.Integer`)                                                        |
| Cypher generation      | **Query builder brought in-tree** (port of `neode/src/Query/*`), modernised to TypeScript, no Integer coupling                                                        |
| Validation             | **Same rule set as neode, powered by Zod** — validators live inside the property type config (`@String({ min: 2, email: true })`)                                     |
| Integration test DB    | **Relate** (`relatedb/relate`) — embedded in-process Cypher engine as the zero-setup default backend, plus Neo4j CE/EE and Memgraph via Bolt (`OGM_TEST_BACKEND=neo4j | memgraph`+`NEO4J_*` env vars), with capability probing to skip unsupported features (e.g. enterprise-only constraints) |
| Definition API         | **Both**: decorators (primary) and map-based schemas (parity with neode) feeding one shared metamodel                                                                 |
| Test discipline        | **Red-green** for every feature; unit suite (no DB) + integration suite (real engines) + benchmarks                                                                   |
| Test runner / bench    | **Vitest 3** with **SWC** transform (supports `emitDecoratorMetadata` for decorators), projects for unit/integration, built-in `vitest bench` for benchmarks          |
| Monorepo orchestration | **Turborepo** at the workspace root (`/Users/adam/neode`), npm workspaces; tasks: build / lint / test / bench                                                         |

---

## 1. Architecture: one metamodel, two front doors

The core design decision that makes "decorators + maps" work without two parallel systems:

```
        decorators (@NodeEntity, @String, @OneToMany…)      map schemas ({ name: { type: 'string', index: true } })
                          │                                        │
                   decorator adapter                         map/schema adapter
                          └──────────────┬─────────────────────────┘
                                         ▼
                    ┌──────────── EntitySchema metamodel ────────────┐
                    │  properties, relationships, labels, PK, …      │
                    └────────────────────┬───────────────────────────┘
                                         ▼
     Validation (Zod) · Query services (create/merge/find/…) · Schema sync · Hydration · Events
                                         ▼
                            In-tree query builder (Cypher)
                                         ▼
                                 neo4j-driver 6.x
```

- The existing global metadata registry (`src/meta`) becomes the **only** source of truth.
- A **map adapter** builds the same `EntitySchema` from neode-style definition objects (`neode.model('Person', {...})`).
- A **golden test** asserts a decorated class and its equivalent map definition produce byte-identical schemas.

---

## 2. Feature inventory — neode 0.4.9 → neode-ogm gap list

### A. Metamodel & definitions

| Feature (neode)                                                                                                                                                                                                        | neode-ogm today                                                       | Work                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Property types: `string, number, boolean, int/integer, float, uuid, date, time, datetime, localtime, localdatetime, point, duration` + `any`                                                                           | only `STRING, UUID, ANY, INTERNAL_ID`, array flag                     | Full type enum + per-type value conversion (CleanValue port)                                                                          |
| Property options: `primary, unique, index, exists, required, protected, hidden, readonly, default` (value or fn)                                                                                                       | `primary, unique, default, onCreateSet, onMatchSet, alwaysSet, array` | Add `index, exists, required, protected, hidden, readonly`; keep onCreate/onMatch (already beyond neode)                              |
| Joi validation pass-through rules (~40: min/max/email/regex/length/alphanum/…)                                                                                                                                         | none                                                                  | Zod rule mapping (see §5)                                                                                                             |
| Shorthand `age: 'number'` in map schema                                                                                                                                                                                | n/a                                                                   | Map adapter                                                                                                                           |
| Multiple labels `labels: [...]`, sorted; `extend()` adds labels                                                                                                                                                        | `setLabels` only                                                      | `labels` schema key, `addLabel`, sorted-merge behaviour                                                                               |
| Default primary key `<lowercase label>_id` when none defined                                                                                                                                                           | none                                                                  | Implement in schema resolution                                                                                                        |
| Relationships: `type/relationship/direction/target/properties/eager/cascade('delete'\|'detach')/alias`                                                                                                                 | partial (type, direction, eager, many)                                | Add per-relationship property schemas, cascade delete **and** detach (neode left `detach` broken — implement it properly), node alias |
| Direction constants `DIRECTION_IN/OUT/BOTH`, invalid → OUT                                                                                                                                                             | `Direction` enum                                                      | Parity + case-insensitive handling                                                                                                    |
| Map registration: `model(name, schema?)`, `with(models)`, `withDirectory(dir)`, `extend(model, as, using)`                                                                                                             | none                                                                  | Map adapter + directory scanner (ESM-safe glob)                                                                                       |
| Decorators: `@Property, @Int, @Float, @Number, @Boolean, @DateTime, @Date, @Time, @LocalTime, @LocalDateTime, @Point, @Default, @OnCreateSet, @OnMatchSet, @Index, @Unique, @Required, @Hidden, @Protected, @Readonly` | only `@String, @Uuid, @Primary, @InternalId`                          | Expand set; **rename `@String` → `@Property({type})` or keep sugar but stop shadowing global `String`**                               |
| `@OneToOne` / `@OneToMany` (+ direction, eager)                                                                                                                                                                        | done                                                                  | Keep; add `@ManyToOne`-style incoming sugar if cheap                                                                                  |

### B. Known bugs to fix (from the spike)

- `uuid` is a devDependency but imported at runtime → move to deps.
- `hydrateRelationship` re-checks `END_NODE` where it should check `OTHER_NODE` (`src/utils.ts:171`).
- `create.service.ts` is an empty file — never implemented.
- Leftover `console.log('?? find me', …)` in `find.service.ts`.
- `String` decorator export shadows the global type in consuming code.
- `TransactionManager` (`src/transaction/manager.ts`) is dead code — wire up or remove.
- Deprecated Neo4j 3.x/4.x constraint syntax in `schema.service.ts` (§6).

### C. Query services (per-operation)

| neode feature                                                                                                | Work                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create()` — CREATE + nested relationship writes (`WriteUtils`, depth 99)                                    | **CreateService** (currently empty) + nested write helper                                                                                        |
| `merge()` on unique+indexed `mergeFields`, `mergeOn(match, set)`                                             | Extend MergeService beyond PK-only                                                                                                               |
| `node.update(props)` — `SET +=`, readonly excluded, required props refilled                                  | UpdateService                                                                                                                                    |
| `node.delete(depth)` cascade; `relateTo(node, type, props, forceCreate)`; `detachFrom(other)`                | DeleteService + cascade ('delete' **and** 'detach'), RelateService (direction inversion for incoming), DetachService, relationship update/delete |
| `all(model, props, order, limit, skip)` — order as string / `{key:'ASC'}` / array                            | GetService parity                                                                                                                                |
| `find` (by primary key) / `findById` (internal id → **`elementId`** on modern servers) / `first(key, value)` | Find services parity + elementId semantics (hydrate `identity` from elementId)                                                                   |
| `withinDistance(prop, point, distance, …)`                                                                   | Port (point type + `point.distance()`)                                                                                                           |
| Eager loading, **multi-degree** (neode `MAX_EAGER_DEPTH = 3`, pattern comprehensions)                        | OGM currently 1 degree — extend `EagerUtils` port                                                                                                |
| `Collection` (`length`, iterator, `first`, `map`, `toJson`)                                                  | Port with typed generics                                                                                                                         |
| Hydration of all value types (temporal, point, arrays, nested)                                               | Port `valueToJson`/`hydrateNode` logic; fix OTHER_NODE bug                                                                                       |
| `toJson()` on nodes/relationships incl. `_id`/`_labels`/eager values                                         | Port                                                                                                                                             |

### D. Sessions, transactions, config

- `readSession`/`writeSession`/`session` kept; add driver-6 idioms where sensible.
- `batch(queries)` — all statements in one tx, rollback on failure, throws `TransactionError` with per-statement errors. (Modern equivalent: single `executeWrite` callback.)
- `transaction()` / `inReadTransaction` / `inWriteTransaction` + `TransactionalService` (exists — extend to full service surface).
- Multi-database: `setDatabase(db)`, per-call override, `NEO4J_DATABASE`.
- `fromEnv()` parity: all `NEO4J_*` env vars neode supports (protocol/host/port, username/password, enterprise flag, encryption, trust, trusted certs, known hosts, pool size, retry time, load balancing, connection lifetime, timeout, lossless integers, logging).
- Events: formalise the existing `EventType` emitter (NODE/MERGED/UPDATED/DELETED, RELATIONSHIP_*) — already beyond neode; keep and document.

### E. Query builder (in-tree port)

Port `neode/src/Query/*` (Builder, Statement, Match, Where*, Order, With, Create, Return, EagerUtils) to TypeScript:

- Full fluent API parity: `match, optionalMatch, where, or, whereRaw, whereBetween, whereNot, whereId, delete, detachDelete, create, merge, set, onCreateSet, onMatchSet, remove, return, with/withDistinct, limit, skip, orderBy, relationship (degrees: 1, '1..2', '0..2', '..3'), to, toAnything, pattern, build, execute`.
- Params auto-naming with dedup (`where_x`, `where_x_2`, …).
- **No `neo4j.Integer`** — native numbers (optionally BigInt).
- Pure function of schema+input → `{query, params}` ⇒ ideal for exhaustive red-green unit tests and benchmarks.

### F. Validation (Zod)

Design: **rule names mirror neode's Joi rules, mapped onto Zod inside each property type.**

```ts
// Decorator form — validators live inside the type:
class Person {
  @Uuid({ primary: true }) id: string
  @String({ min: 2, max: 50, required: true, index: true }) name: string
  @String({ email: true }) email: string
  @Number({ min: 0, max: 150 }) age: number
  @DateTime({ default: () => DateTime.now() }) createdAt: DateTime
}

// Map form — identical rule names:
neode.model('Person', {
  id: { primary: true, type: 'uuid' },
  name: { type: 'string', min: 2, max: 50, required: true, index: true },
  age: 'number',
})
```

- A **rule table** maps neode rule names → Zod operations (`min → .min()`, `email → .email()`, `regex → .regex()`, …); unknown rule names throw with neode's helpful error style.
- Custom Zod schemas for driver temporal types (`Date/Time/DateTime/LocalTime/LocalDateTime`) and `Point` (SRID checks: 4326/4979/7203/9157) replace neode's custom Joi extensions; `duration` gets a real rule (neode never had one).
- `ValidationError` parity: collected issues (zod flatten ≙ `abortEarly: false`), `.details`, `.input`.
- Unknown/extra keys allowed (`allowUnknown`), `strict` mode per property.

### G. Schema sync (modern syntax)

- `CREATE CONSTRAINT <name> IF NOT EXISTS FOR (n:Label) REQUIRE n.prop IS UNIQUE`
- `CREATE INDEX <name> IF NOT EXISTS FOR (n:Label) ON (n.prop)`
- Property existence (`REQUIRE n.prop IS NOT NULL`) — Enterprise only, gated by `isEnterprise()`
- Deterministic names (`<label>_<prop>_unique` etc.) so `drop()` reverses `install()` cleanly
- Keep `SchemaResult[]` reporting (action/type/label/property/statement/success/error) — already nicer than neode

---

## 3. Testing strategy (red-green is a must)

### Structure

```
test/
  unit/          # no DB — runs everywhere, fast
  integration/   # real Neo4j via Relate (or NEO4J_* env override)
  bench/         # vitest bench suites
  fixtures/      # shared entity/model definitions (Person/Movie/Role/Location + full-type model)
```

### Red-green discipline

Every work item lands as: 1) failing test(s) written first, 2) minimal implementation, 3) green, 4) refactor. Enforced per-phase checklists below. CI runs unit tests on every push; integration suite on PRs.

### Unit suite (no DB)

- Decorators → metadata registry (expand existing `decorators.test.ts`)
- Map adapter ⇄ decorator **golden parity tests**
- Query builder: Cypher generation for every clause/combo, param dedup, direction/degrees, eager patterns
- Rule table: every neode rule name → expected Zod behaviour; ValidationError shape
- Value conversion (CleanValue port): each type in/out, temporal/point handling, hidden/protected filtering
- Schema statement generation (modern syntax, naming, enterprise gating)
- Hydration: records → entities, nested eager values, arrays, elementId

### Integration suite (Relate-managed Neo4j)

- Bootstrap: `@relate/common` installs & starts a DBMS (cached across runs) → build driver from it; `NEO4J_*` env vars override for an external server; enterprise-gated tests skip unless an enterprise DBMS is configured
- Every query service end-to-end; CRUD lifecycle; relationships both directions; cascade delete **and detach**; eager loading at depths 1–3; batch + rollback → `TransactionError`; schema install/drop (assert via `SHOW CONSTRAINTS` / `SHOW INDEXES`); withinDistance; multi-database (if supported by target server)
- Cleanup between tests (`DETACH DELETE` per fixture label in `beforeEach`/`afterEach`)

### Benchmarks (`vitest bench`, tinybench under the hood)

| Benchmark                           | Measures                                                          |
| ----------------------------------- | ----------------------------------------------------------------- |
| Decorator + map schema registration | metamodel overhead                                                |
| Query builder `.build()`            | Cypher generation ops/sec (small/large queries)                   |
| Validation throughput               | Zod rule chains vs rule count                                     |
| Hydration                           | N nodes / N nodes+military-grade eager records → entities         |
| E2E CRUD round-trip                 | save/find/update/delete vs **raw driver** baseline (OGM overhead) |
| neode vs neode-ogm                  | same scenario script against both, for parity sanity              |

Run via `npm run bench`; committed baseline + script to diff results locally (CI publishes but doesn't gate).

---

## 4. Tooling

| Concern        | Choice                                                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language/build | TypeScript 5.9 strict, `tsc` → CJS output (dual ESM deferred to Phase 8 — tsc is the only correct emitter of decorator metadata, and its ESM output needs `.js` import extensions), `exports` map, declarations |
| Test/bench     | **Vitest 3 + unplugin-swc** (SWC `decoratorMetadata` replaces tsc's `emitDecoratorMetadata` in the test transform); `vitest bench` (tinybench) for benchmarks                                                   |
| Lint/format    | **ESLint 9 flat config** (`typescript-eslint` v8) + Prettier 3                                                                                                                                                  |
| Integration DB | Relate embedded (default, zero-setup) · Neo4j CE/EE · Memgraph — selected via `OGM_TEST_BACKEND`, capability-probed                                                                                             |
| CI             | GitHub Actions: lint → unit → integration (Relate, built from source) → build; optional Neo4j job behind `NEO4J_*` secrets                                                                                      |
| Runtime deps   | `neo4j-driver@^6`, `reflect-metadata`, `dotenv` — no `uuid` (native `crypto.randomUUID`), no `@neode/querybuilder` (in-tree port)                                                                               |
| Package        | Decide final name at publish time (keep `@neode/beta` vs `@neode/ogm`); `files: [dist]`, prepublish build                                                                                                       |

---

## 5. Phased roadmap (each phase = red-green loop)

**Phase 0 — Foundations & hygiene** ✅ _(complete — see status below)_
Repo modernisation: TS 5 strict, Vitest, ESLint/Prettier, dual build, CI skeleton; fix the known bugs (§2-B); Relate test bootstrap + fixtures; `npm test` (unit) and `npm run test:integration` green for the _existing_ feature set.
✅ _Done when: CI green; existing spike behaviour covered by tests._

**Phase 0 status (complete):**

- Toolchain: TypeScript 5.9 strict · Vitest 3 + SWC (`decoratorMetadata`) · ESLint 9 flat config · Prettier · Turborepo workspace at repo root · GitHub Actions CI
- Query builder ported in-tree (`src/query/`) — 37 unit tests, red-green; fixes neode's broken `or()` connector semantics; `whereId` now `elementId()`-based; zero `neo4j.Integer` coupling
- Connection port abstraction (`src/driver/`): `ConnectionProvider` + `TransactionHandle` normalised over **neo4j-driver 6** (Neo4j CE/EE, Memgraph) and the **embedded Relate engine**; value normalisation (`GraphNode`/`GraphRelationship`, `elementId`-first)
- Typed CRUD API: `find<Person>(Person, id)` style generics; `Neode.forDriver()` / `Neode.forRelate()` factories; `TransactionalService` over the port; typed repositories
- Integration harness: backend selection + capability probing (edition/constraints/temporals/points/multi-database), per-file entity fixtures, graph cleanup
- Bug fixes vs the spike: `hydrateRelationship` OTHER_NODE copy-paste · `delete()` no-op (statement had no DELETE clause — now `DETACH DELETE`) · MERGE never matching (defaults resolved into the merge map, regenerating UUIDs per save) · `String` decorator's global shadowing still pending Phase 1 rename · removed dead `TransactionManager`, empty `create.service`, debug `console.log` · `uuid` devDep dropped for `crypto.randomUUID`
- Verification: **64/64 tests green** (50 unit + 14 integration on Relate), lint clean, strict tsc clean, bench harness proven, `turbo run lint test build` green

**Phase 1 — Metamodel & both definition methods**
Full `EntitySchema`/`PropertySchema` expansion (all types + options), map adapter (`model/with/withDirectory/extend`), decorator set expansion & renames, default PK, labels.
✅ _Done when: golden parity tests prove decorator ⇄ map equivalence for every schema shape._

**Phase 2 — Query builder in-tree**
Full port + modernisation; exhaustive Cypher-generation unit tests.
✅ _Done when: builder API parity checklist green; zero Cypher strings hand-written in services._

**Phase 3 — Validation (Zod)**
Rule table, temporal/point schemas, ValidationError parity, wired into both adapters.
✅ _Done when: every neode README validation example has an equivalent decorator + map test._

**Phase 4 — Query services to parity**
Create (+nested writes), merge/mergeOn, update, delete+cascade/detach, relate/detach, all/find/findById/first, withinDistance, multi-degree eager, Collection, hydration, elementId.
✅ _Done when: integration suite covers each service; neode's example app (`example/index.js` flow) runs against neode-ogm._

**Phase 5 — Sessions, transactions, batch, config**
fromEnv parity, batch+TransactionError, TransactionalService completion, multi-database, events formalised.
✅ *Done when: batch rollback test proves all-or-nothing; all NEO4J_* env vars honoured.*

**Phase 6 — Schema sync**
Modern constraint/index syntax, naming, install/drop, enterprise gating.
✅ _Done when: install→SHOW→drop round-trips green against Relate Neo4j 5.x._

**Phase 7 — Repository pattern + instance API (the "full flavour")**
Typed `getRepository(Person)` with CRUD + query methods; hydrated entities get instance methods (`save/update/delete/relateTo`); finish the abandoned repository spike properly.
✅ _Done when: TypeORM-style and neode-style usage both documented and tested._

**Phase 8 — Benchmarks, docs, release**
Bench suites vs raw driver + neode; README/migration guide; API docs; publish prep.
✅ _Done when: `npm run bench` stable, docs complete, package publishable._

---

## 6. What I need from you

1. **A green light per phase** — I'll start at Phase 0 and proceed phase-by-phase, red-green each feature.
2. **Relate specifics** — confirm OK to install a Neo4j 5.x DBMS via Relate on this machine (it downloads a distribution + Java runtime into its own env directory), or whether you'd rather point tests at a server you already run.
3. **Enterprise edition** — property-existence constraints need Neo4j Enterprise to test for real. Happy to gate+skip those tests, or you supply enterprise credentials/license acceptance later.
4. **Final package name** whenever we get to publishing (not blocking development).
5. **Any must-have APIs from neode's ecosystem I should prioritise** (e.g. you use `withinDistance` or batch heavily? I'll sequence those earlier).
