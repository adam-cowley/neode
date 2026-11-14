# Migrating to neode 1.0 (modern TypeScript stack)

The 1.0 line is the modern-stack rewrite: strict TypeScript, standard
(ES) decorators, dual ESM+CJS build, neo4j-driver 6 as a peer dependency.
The public API surface (default `Neode` export, named exports) is otherwise
unchanged from 0.2. Every removal below was deliberate.

## 1. Standard decorators (no more `reflect-metadata`)

Decorators are now the language's standard TC39 decorators — no
`experimentalDecorators`, no `emitDecoratorMetadata`, no `reflect-metadata`
dependency, no SWC transform in your build.

- **Relationship decorators require an explicit target.** The `design:type`
  reflection is gone:

  ```ts
  // before (0.2, legacy decorators + reflect-metadata)
  @OneToOne({ type: 'LIKES', direction: 'OUT' })
  likes: Person

  // after (1.0, standard decorators)
  @OneToOne({ type: 'LIKES', direction: 'OUT', target: () => Person })
  likes: Person | undefined
  ```

  `@RelatedOne` / `@RelatedMany` need either `target()` or `fields`.
- **Entity classes require a class decorator.** `@NodeEntity()` /
  `@RelationshipEntity()` drives the property registration; field decorators
  alone register lazily only where the runtime exposes `Symbol.metadata`.
- **Decorated fields need `!`** when declared without an initializer
  (`name!: string`) — bundlers that erase type-only declarations drop
  initializer-less fields (and their decorators) entirely.
- Calling decorator factories as plain functions (`Property()(target, key)`)
  is no longer supported — declare real classes.

## 2. Dual ESM + CJS build (tsdown)

`dist/` now ships `index.mjs` (ESM), `index.cjs` (CJS) and matching `.d.mts`
/ `.d.cts` types. The `exports` map routes each consumer correctly.

- **Deep dist imports break**: `neode/dist/decorators` and similar
  paths no longer exist. Import from the package root — everything public is
  re-exported there.
- CJS consumers: `require('neode')` returns the exports object — use
  `.default` for the `Neode` class (same as 0.2).

## 3. neo4j-driver is a peer dependency

`neo4j-driver@^6` must be installed by the consumer, so your app, the OGM
and any other Neo4j library share one driver instance:

```bash
npm i neo4j-driver@^6
```

**APOC is a server requirement you opt into, never a library one.** neode
never emits an `apoc.*` call itself — the only source is your own
expressions through the `expr` helpers (`expr.apocCollToSet(...)` /
`expr.apocBase64Encode(...)` compose `apoc.coll.toSet(...)` /
`apoc.text.base64Encode(...)`). Statements using them need the APOC plugin
installed on the connected server; a plain `neo4j:5-community` container
fails those writes with `Unknown function 'apoc.coll.toSet'`.

## 4. Toolchain requirements

- Node ≥ 20
- TypeScript ≥ 5.9 recommended (strict mode; the published types are built
  with `strict`, `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`
  on — expect stricter types in your editor)
- The package is `"type": "module"` with a CJS fallback; bundlers and both
  Node module systems are supported (verified with publint + attw).

## 5. Smaller behavior changes

- **`batch()` is `runAll()` (NTS-624).** `Neode#batch()` is renamed
  `runAll()` — same arguments (statements with optional params, optional
  database), still ONE transaction: every statement commits, or the
  transaction rolls back and the thrown `TransactionError` carries the
  per-statement errors, the partial results and the failed statements.
  For throughput batching, `createMany()` / `mergeMany()` (UNWIND per
  chunk) replace the batch loop.
- **`@String` is removed (NTS-670).** Use `@Property({ type: 'string' })` —
  the deprecated decorator shadowed the global `String` type. `setDeprecationWarnings()`
  went with it: with `@String` gone there are no deprecated surfaces left to warn about.
- **Schema DDL names changed — ONE-TIME RENAME CHURN (NTS-598).** Generated
  constraint/index names now carry a deterministic hash suffix
  (`person_email_unique_b37312eb`) that makes them injective: `User` and
  `user` labels no longer collide, and composite property lists like
  (`a`,`b_c`) vs (`a_b`,`c`) no longer collide. On your first
  `installSchema()` / drift apply against an existing database, every
  previously installed constraint and index is reported stale and — with
  `dropStale: true` — dropped and recreated under the new name. Review the
  drift before applying on shared databases; uniqueness is briefly
  unenforced while an object is being recreated.
- **The edition is detected, not flagged (NTS-598).** `installSchema()` /
  `inspectSchema()` / drift probe `CALL dbms.components()` and declare
  Enterprise-only DDL (existence + property-type constraints) only when the
  connected server really is Enterprise. The manual `enterprise` flag /
  `NEO4J_ENTERPRISE=true` no longer decides this (it still gates graph
  types); `inspectSchema()` no longer takes an `enterprise` option. A
  wrongly-set flag no longer produces false "stale" drift on Community.
- **Graph-type drift fails loudly on unparseable canonical text (NTS-598):**
  `SHOW CURRENT GRAPH TYPE` output the parser cannot read now throws instead
  of silently reporting bogus drift — a parse failure is a library bug.
- **Error messages are richer** (NTS-446): missing-model errors name the
  registered models; hydration failures name the model and property. If you
  matched on exact old messages, loosen the patterns.
- **Out-transforms are sync-only** (NTS-449): an async `out` transform is
  rejected at hydration with a descriptive error.
- Integer values beyond `Number.MAX_SAFE_INTEGER` are rejected instead of
  silently losing precision.
- **Transactions (NTS-582 / NTS-589):** after* hooks run only after the
  commit, and an error one throws surfaces after the data has committed
  (it rejects the `transaction()` callback / `commit()` — the write stands).
  A facade call inside `transaction()` passing a per-call `database`
  different from the outer transaction now throws instead of being silently
  dropped — set `database` on the outermost `transaction()`.
- `strictPropertyInitialization` no longer disabled: entities declared in
  TypeScript need `!` on decorator-populated fields (see §1).

## 6. Delete semantics (NTS-595, pre-1.0 breaking changes)

Two intentional breaking changes on the write path — both approved as
pre-1.0 corrections:

- **Cascade is annotated-only.** `delete()` now cascades only into
  relationships explicitly declared `cascade: true`; un-annotated
  relationships are detached, not deleted — their target nodes survive.
  To delete every related node regardless of annotations, pass
  `{ cascade: true }`; `{ cascade: false }` cascades nothing. Before,
  an unannotated relationship's targets were deleted too.

  ```ts
  // before: delete() destroyed the Warehouse as well
  // after: only the annotated `lines` chain is deleted
  await neode.delete(factory)
  await neode.delete(factory, { cascade: true }) // old behaviour, opt in
  ```

- **`deleteAll()` is guarded.** Calling it with no filters now throws —
  with no filters it deletes every node carrying the model's labels.
  Pass at least one filter to delete a subset, or `{ all: true }` to
  confirm the wipe (the same destructive-guard model as `wipe()`,
  NTS-578).

  ```ts
  await repo.deleteAll() // now throws, with a fix hint
  await repo.deleteAll({ status: 'stale' }) // filtered subset
  await repo.deleteAll({ all: true }) // confirmed full wipe
  ```

Also new on the delete path: the self-referential cascade walk is capped
at `MAX_CASCADE_DEPTH = 10` hops (exported from the package root,
overridable per call with the `depth` option of `delete()`), and
`@SoftDelete` deletes are idempotent — a repeat soft delete is a no-op
that never re-stamps `deletedAt`.

## 7. Builder: aliases are plain identifiers (no pattern fragments)

Every pattern method — `match()`, `merge()`, `relationship()` / `to()`,
`shortestPath()`, … — takes its alias as a plain identifier
(`[A-Za-z_][A-Za-z0-9_]*`): aliases render verbatim into the pattern and
cannot be escaped without changing meaning. Pre-formed pattern fragments
are rejected with a `NeodeError`:

```ts
// before (0.2): hand-written pattern strings
builder.match('cl:Claim { eventId: ev.id, email: email }')
// now throws: Invalid alias "cl:Claim { … }" in match()

// after (1.0): compose the pattern from the builder
builder.match('cl', 'Claim').whereProps('cl.eventId', '=', 'ev.id')
```

- **Reference predicates** are `whereProps(left, operator, right)` over
  `alias.property` references — operators `=`, `<>`, `<`, `<=`, `>`, `>=`,
  `IN` (`whereRaw()` for anything else).
- **A MERGE keyed on a reference** passes the reference as a
  `RawExpression` property value —
  `merge('cl', 'Claim', { eventId: new RawExpression('ev.id') })` renders
  `MERGE (cl:Claim { eventId: ev.id })`.
- **Anonymous relationship targets are rejected too**: `.to('', 'Label')`
  throws `Invalid alias ""` — pass a named alias
  (`.to('other', 'Label')`).

## 8. `neode/express` REST contract (NTS-664)

`router(neode)` from `neode/express` mounts CRUD over the registered
models:

- **Node models only.** Relationship-entity models are not exposed — the
  node CRUD paths do not apply to edges. `GET /` (the ontology) reports
  what is mounted.
- **Error bodies are `{ error, message, issues }`** — the error's `name`
  and `message`, plus `issues` for a `ValidationError` (HTTP 422). The
  key is `issues`, not `details`. 409 for constraint violations and
  optimistic-lock races, 400 for other `NeodeError`s, 404 for unknown
  routes.

## Questions

The full migration plan and per-phase notes live in `docs/migration-notes.md`;
the decorator architecture is documented in
`docs/decisions/0001-decorators.md`.
