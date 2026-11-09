# 0002 — Typing eager loads: the type-level model map and the narrowed `with()` return

**Status:** accepted (NTS-154 spike, supersedes the open question in 0001's
consequences)

## Context

No graph OGM narrows read return types with the requested relations
(report items #2/#3, Tier 1): Prisma, Drizzle and MikroORM do. neode-ogm's
decorators are standard TC39 with no `emitDecoratorMetadata` (decision
0001), so a field decorator learns its key and target thunk only at
RUNTIME — nothing flows back into the class's type. The eager-loading
machinery (static `eager` flags, the NTS-560 per-query `with` load spec,
the NTS-498 multi-level per-instance `load(spec)`) was merged before this
spike; the types checked that requested keys EXIST on the entity
(`WithSpec<T>` = every key of T) but the return type never narrowed and
property keys type-checked.

## Decision

1. **The type-level model map is a phantom static on the entity class**
   (`neodeRelationships`), read structurally off the CONSTRUCTOR type:

   ```ts
   @NodeEntity()
   class Person {
     @OneToMany(() => Pet, 'HAS_PET', Direction.OUTGOING) pets?: Pet[]
     @OneToOne({ type: 'HAS_CARD', target: () => Card }) card?: Card

     // erased at emit — zero runtime footprint, TC39-safe
     declare static readonly neodeRelationships: { pets: true; card: true }
   }
   ```

   The value side is keys-only (`true`): cardinality and target types
   come from the declared FIELD types (`pets?: Pet[]`), which the author
   writes once anyway. The map's only job is the relationship-vs-property
   distinction the field types cannot express. No module augmentation, no
   registry search, no structural ambiguity between models.

2. **`QueryLoadSpec<C>`** (keyed by the model constructor) checks the
   `with` spec against the map when the model declares one, and falls
   back to `QueryLoadLevel<T>` (declared object/array field keys —
   primitive property keys excluded) when it does not. Every level is
   `LoadOptions & { [relationshipKey]?: true | LoadSpec | next level }` —
   an INTERSECTION, so a level may mix trim keys (`order` / `skip` /
   `limit` / `withoutFilters`) and nested relationship keys in one object,
   exactly what `parseLoadLevel` reads at runtime (NTS-498). A
   relationship named exactly like a reserved option key is unusable in
   the spec, mirroring the runtime reservation (single-key `load(key)`
   still reaches it).

3. **`LoadedEntity<T, W>`** narrows the returns of `find` / `all` (facade
   and transaction mirrors): an array field loads `Item[]`, an entity
   field loads `Item | undefined` (a one-key read with no related row
   yields undefined — the runtime hydration contract), recursed through
   the spec's nested levels.

   ```ts
   const user = await neode.find(Person, id, { with: { pets: { toys: true } } })
   // (Person & { pets: (Pet & { toys: Toy[] })[] }) | undefined
   ```

4. **The query-level runtime accepts nested spec objects** (the one
   runtime touch): a `with` entry that is a plain object parses via
   `parseLoadLevel` against the target's schema and renders via
   `specLevelPattern` — the same fragments the per-instance `load(spec)`
   path (NTS-498) already projects. One statement per read, nested keys
   validated down the declared relationship graph, descriptive errors
   unchanged. Decorating callbacks keep their CALL-subquery rendering.

## The ceiling (what the spike did NOT achieve and why)

- **Decorators still cannot contribute types.** The map is one
  user-authored declaration per model. Closing it needs
  `emitDecoratorMetadata` (banned, decision 0001) or a codegen step —
  neither is worth it while the phantom is one line.
- **The instance surface keeps the loose key domain.** `instance.load(spec)`
  (NTS-498) types its spec off `this` — the INSTANCE type — and TS has no
  instance→constructor link, so the map cannot be consulted there.
  `InstanceLoadLevel` also rejects mixed trim+nested level literals (its
  value union is not an intersection); the query-level spec does not have
  this problem. Follow-up candidates: a name-carrying phantom plus a
  declaration-merging registry keyed by model name.
- **Property keys can slip to the legacy overloads.** `INeode` (the type
  the Repository programs against) keeps the NTS-560 signatures
  (`WithSpec<T>` — every key of T), and the facade's overload set must
  stay assignable to it. A fresh literal with a wrong key is caught
  (the narrowed overload is tried first, and the legacy one rejects
  unknown keys), but a PROPERTY key (`{ name: true }`) falls through to
  the legacy overload's keyof-T domain — the runtime then rejects it with
  the descriptive NeodeError. Compile-time exclusion requires re-keying
  INeode by constructor (breaking follow-up).
- **Property keys fall through to the legacy overloads.** Unknown keys
  and wrong nesting are rejected at the call level on BOTH tiers (the
  narrowed overload is tried first, and its constraint carries the domain
  to excess-property-check against), but a PROPERTY key (`{ name: true }`)
  is a keyof-T member, so the legacy `ReadOptions` / `WithSpec<T>`
  overload accepts it — no narrowing claim, and the runtime validation
  throws the descriptive NeodeError. The legacy overloads stay because
  `INeode` (the type the Repository programs against) keeps the NTS-560
  signatures; compile-time exclusion requires re-keying INeode by
  constructor (breaking follow-up).
- **Non-fresh spec objects lose excess-property checks** — standard TS,
  same as NTS-560.
- **The Repository does not narrow.** `Repository<Entity>` holds the
  constructor widened to `new () => Entity`; its `FindOptions.with` is the
  fallback-tier `QueryLoadLevel<Entity>` (nested levels type-check, no
  return narrowing). Follow-up: parameterize Repository by the
  constructor type.
  _(RESOLVED by NTS-563: `Repository<Entity, C>` and
  `getRepository(entity: C)` keep the constructor type, so the
  Repository's `with` spec is map-checked and find / findAll narrow. The
  Repository surface never had the legacy keyof-T overloads, so a
  PROPERTY key is a compile error there — stricter than the facade.)_
- **Spec depth bounds type recursion, not TS limits.** `LoadedEntity` /
  `QueryLoadLevel` recurse once per SPEC level (the runtime's
  `MAX_EAGER_DEPTH = 3` only caps the static eager patterns; spec-driven
  rendering is uncapped by design). Three levels are tested; deeper specs
  will strain editor latency before they hit TS's instantiation limits.
- **defineModel (map API) models have no phantom** — the fallback tier
  applies. A generated phantom would need the codegen route.

## Consequences

- Reads narrow at the use site with zero runtime cost beyond the merged
  machinery; the phantom is opt-in per model and optional everywhere.
- The `with` surface is now TWO precise tiers: map-checked (phantom) and
  field-inferred (fallback) — both exclude property keys from the narrowed
  overload.
- Follow-up issues should start from this document: INeode re-keying and
  the instance-surface map are independent slices (the Repository
  constructor generics shipped as NTS-563).
