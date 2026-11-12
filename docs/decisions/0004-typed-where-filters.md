# 0004 — Typing where filters: the property-keyed filter bag and the operator-object tier

**Status:** accepted (NTS-646 design pass; implementation tracked by NTS-646)

## Context

Read-side filter bags are `Record<string, unknown>` everywhere — facade `get` / `getFirst` / `first` / `all` / `paginate` / `findManyAndCount` / `chunk` / `lazy` / `withinDistance` (`src/neode.service.ts`), their `TransactionalService` mirrors, and the `Repository` bags (`Partial<Entity>`, already keyed but undiscriminated). A mistyped property name compiles and is then **silently ignored at runtime**: every equality consumption site iterates the schema's _declared_ properties and skips unknown keys (`GetService` `src/services/query/get.service.ts` L29–35, `Repository#matchAll` L200–206, `PaginateService.applyFilter` L247–259, `ProjectionService.applyFilters` L90–132 — four copies of the same loop). The result is a query that succeeds and returns wrong (unfiltered) rows.

Two facts constrain the design:

- **There is no operator-keyed filter bag at runtime today.** The bag is flat property → value equality. Comparison / membership / string operators exist only as `Builder` methods (`where(prop, '>', v)`, `whereNot`, `whereIn`, `whereContains`, `whereStartsWith`, `whereEndsWith`, `whereNull` / `whereNotNull`) — the raw escape hatch this issue explicitly does not touch. `search()` / `knn()` take no filter bag at all (only `withoutFilters`).
- The `with`-spec tier (NTS-154, refined by NTS-563) is map-checked through the `neodeRelationships` phantom (`src/query/load-spec.ts`): `DeclaredRelationships<C>` reads the map structurally off the constructor, `RelationshipKeysOf<T>` is the map-less fallback domain, `FieldTarget<T, K>` descends into array/entity field types. Filters have no equivalent — and ADR 0002 already established that decorators cannot contribute field types (no `emitDecoratorMetadata`, decision 0001), so any key domain is built from the declared _field_ types, exactly like the with-spec tier.

## Decision

**1. One checked type, `WhereFilter<C>`, keyed off the model constructor — no phantom map required.**

```ts
// Instance-level key domains (mirroring load-spec.ts):
type PropertyKeys<T> = Exclude<keyof T, RelationshipKeysOf<T> | MethodKeys<T>>

type FilterOperators<V> = {
  eq?: V
  neq?: V // Builder.whereNot
  gt?: V // Builder.where(prop, '>', v)
  gte?: V
  lt?: V
  lte?: V
  in?: V[] // Builder.whereIn
  contains?: V extends string ? string : never // Builder.whereContains
  startsWith?: V extends string ? string : never
  endsWith?: V extends string ? string : never
  null?: boolean // Builder.whereNull / whereNotNull
}

type FilterOperand<T, K extends keyof T & string> =
  | T[K] // bare value = equality (today's bag, byte-identical Cypher)
  | FilterOperators<NonNullable<T[K]>>

type WhereFilterLevel<T> = {
  [K in PropertyKeys<T> & string]?: FilterOperand<T, K>
} & {
  [K in RelationshipKeysOf<T> & string]?: WhereFilterLevel<FieldTarget<T, K>>
}

export type WhereFilter<C extends Newable> = C extends new (
  ...arguments_: never[]
) => infer T
  ? WhereFilterLevel<T>
  : never
```

The key domain is **declared fields**: property keys take bare values or operator objects, relationship keys take nested filter bags (recursing through `FieldTarget`, the same descent `QueryLoadLevel` uses). No second phantom static: unlike `with` — which must distinguish relationship keys from property keys of object type and therefore needs the map's exact truth — the filter bag's fallback domain is safe because a mis-filed key is caught by the _runtime_ consumption loop, which iterates `getProperties()` and rejects (see 3) what the type let through. The map-less design is the same trade ADR 0002 made against codegen: one line of author burden beats a declaration that duplicates the decorators.

**2. The operator set is exactly the `Builder` methods that take `(property, value)`.** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`, `startsWith`, `endsWith`, `null` — each maps 1:1 onto an existing Builder method, so the runtime tier is mechanical. Deliberately absent: `between` (compose `{ gte, lte }` — Builder renders the same two-sided predicate), `nin` (no Builder counterpart), and every raw/alias-taking operator (`whereRaw`, `whereExists`, `whereAny`, `whereLabel`, `whereId`, subqueries) — those stay Builder-only by design; a filter bag that grew them would be a second query language.

**3. Runtime: equality is byte-identical; operator objects are a new, additive tier; every miss fails loud.** The duplicated consumption loops (GetService, Repository `matchAll`, PaginateService, WithinDistanceService, and the facade's `deleteAll` — the sixth copy, missed at first pass) collapse into one shared helper (`applyFilterBag(builder, schema, parameters, alias?)`); the projection path keeps its traversal loop (aliases, `EXISTS { … }`) and renders its operator tier through the same helpers. The shared helper: iterates declared property keys (unchanged equality path — every query expressible today renders the identical Cypher), detects an operator object by the `isFilterMap` plain-object rule (so `Date` / driver temporals / `Point` stay equality values), renders each operator through its Builder method with values bound as parameters, and **throws a descriptive `NeodeError` on every miss** (fail loud, same rule as `ProjectionService`'s nested-filter rejection): an unknown operator key, an unknown bag key (with a did-you-mean over the declared properties), a **nested relationship bag on a non-projection read** (the plain path would silently ignore it — on `deleteAll` that is an unfiltered wipe), and an **empty operator object** (rendering it would filter nothing). Property keys that are not plain identifiers are backtick-escaped, never interpolated raw (the map API accepts arbitrary keys). The `deleteAll` paths strip their `all` confirmation flag before the match for the same reason. Nested relationship bags keep today's semantics where they RUN: consumed by the projection path. Object-valued properties carry no bare-map equality at runtime — a plain map is operator-shaped by the rule above, so `{ config: { eq: value } }` is the wrapper form (there is no `object` property type; any-typed fields only).

"Runtime Cypher unchanged" (the issue's AC) is read as: **every query expressible before this change renders identical Cypher**. Operator objects are a new tier — they render new Cypher, deterministically, always parameterised. The keyset paths (`paginate` with `after`/`before`, `lazy`, `chunk`) render the operator tier too: the hand-written statement emits the same `Where` / `WhereNull` clause classes through a shared condition renderer (`renderFilterOperatorConditions`) instead of rejecting operator objects.

**4. Threaded through every bag entry point, no legacy overload.** Facade `get` / `getFirst` / `first` / `all` / `paginate` / `findManyAndCount` / `chunk` / `lazy` / `withinDistance`, the `TransactionalService` mirrors, and the `Repository` bags (`Partial<Entity>` → `WhereFilter<C>`). Unlike the with-spec tier — which kept a loose legacy overload on the facade — the filter bag takes the NTS-563 lesson: **no fallthrough**. A `Record<string, unknown>` variable can still be cast at the call site; the typed literal path is the contract.

**5. Unknown key = compile error, via object-literal excess-property checking.** The dominant usage is a literal at the call site, where TS rejects keys outside the mapped domain — property typos, method keys, relationship keys used as values. Both halves of the AC fall out of one type: equality _and_ operator-object literals are checked against the same key domain, and an unknown key inside an operator object (`{ age: { gte_: 3 } }`) is rejected the same way. Value-type mismatches (`{ age: { gte: 'x' } }`) are rejected too.

## The ceiling

- **Non-literal bags widen past the check — the runtime is the backstop.** A filter built dynamically into a `Record<string, unknown>` and passed as a variable escapes excess-property checking (TS checks literals, not widenings), but the shared consumption helper validates every bag key against the schema (assertFilterKeys) and throws on unknown keys and misplaced nested bags — a widened bag can no longer silently no-op, the Mongoose `strictQuery` lesson.
- **Object-typed properties (e.g. `@Point`) can fall out of the fallback key domain** — `RelationshipKeysOf` classifies object-typed fields as relationships, so a Point property key is rejected as a filter key unless a `neodeRelationships`-style refinement says otherwise. Parity with the with-spec tier's known limitation.
- **Nested filters type-check everywhere but only run on the projection path** (models with projected properties or an explicit `with` spec). Everywhere else a nested bag throws instead of silently no-oping — the type promises more than every path delivers, so the paths that cannot deliver refuse instead of lying. Making nested filters universal is a runtime feature, not a typing one.
- **`search()` / `knn()` stay untyped bags** — they accept no filter bag today (only `withoutFilters`); typing them first requires a runtime feature.

## Consequences

- A mistyped filter key stops compiling instead of silently returning unfiltered rows — the T1 trace's compile-error guarantee, delivered at the type level with zero runtime cost for existing queries. The runtime tier backs the type up everywhere the type cannot see: unknown keys, misplaced nested bags and unknown operators throw, so a dynamically-built bag gets the same guarantee the literal does.
- One shared consumption helper replaces the duplicated loops (six copies, including the facade's `deleteAll`); operator support lands everywhere at once (facade, transactions, repository, pagination, keyset) instead of per-site drift.
- The operator tier is additive and parameter-bound only; the raw-Cypher escape hatch (`Builder.where`) keeps its untyped surface untouched.
- Tests: type tests in `test/types/nts-646.test-d.ts` (mirroring `nts-154` / `nts-563` acceptance and `@ts-expect-error` rejection patterns), Cypher assertions for the operator tier on both rendering paths (Builder tier and keyset renderer), unit tests for the shared helper's rejections (unknown key with did-you-mean, nested bag on the plain path, empty operator object, unknown operator, string/array value rules) and the Date/Point pass-through rule.
- Breaking at the type level (unknown keys stop compiling) AND at the runtime level (call sites that silently no-op on unknown keys, nested bags on non-projection reads, or plain-map equality values now throw) — acceptable inside `1.0.0-next`, shipped as minor per the changeset convention for feature work.
