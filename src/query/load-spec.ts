import type { OrderSpec } from './order-spec.js'

/**
The sub-builder a load spec callback receives (NTS-560): the
comprehension / subquery-legal operations only — where, orderBy, limit,
skip. No return(), no writes, no statement segments. Property names are
bare ("orderDate") — the loader prefixes them with the related node's
variable. Every method returns the view for chaining.
*/
export interface RelationQuery {
  where(...arguments_: unknown[]): RelationQuery
  orderBy(...arguments_: unknown[]): RelationQuery
  limit(limit: number): RelationQuery
  skip(skip: number): RelationQuery
}

/**
Traversal options for a lazy relation load (`instance.load(key, options)`,
NTS-558): pushed into the traversal's ORDER BY / SKIP / LIMIT — the sorted
and truncated related reads that otherwise drop callers to a raw Builder.
*/
export interface LoadOptions {
  order?: OrderSpec
  skip?: number
  limit?: number
  /**
  Named read filters to disable for this load (NTS-162)
  */
  withoutFilters?: string[]
}

/**
One entry of a load spec (NTS-560): a callback decorating the relation's
read. `true` (a plain request) is also accepted at the `with` key.
*/
export type LoadSpec = (relation: RelationQuery) => void

/**
The `with` load spec on find / findAll / all (NTS-560): relationship key
-> request. Keys must name relationships declared on the model — unknown
keys are rejected at compile time when the model type is known and throw
a NeodeError at runtime.
*/
export type WithSpec<T> = {
  [K in keyof T]?: true | LoadSpec
}

/**
Options for the model reads that accept a load spec (NTS-560).
*/
export interface ReadOptions<T> {
  /**
  Per-relation eager load: request a non-eager relationship (`true`) and
  optionally decorate its read (order / limit / skip / where) — rendered
  into the same RETURN projection statement, hydrated entities included
  */
  with?: WithSpec<T>
  /**
  Per-call database override (find())
  */
  database?: string
  /**
  Named read filters to disable for this query (NTS-162) — each name is
  independent; `softDelete` names the built-in @SoftDelete filter.
  */
  withoutFilters?: string[]
}

// ---------------------------------------------------------------------------
// The type-level model map (NTS-154)
// ---------------------------------------------------------------------------

/**
The declared relationship map of a model constructor (NTS-154), read off
the class's phantom `neodeRelationships` static — `undefined` when the
model declares none (the `with` spec then falls back to the inferred
object/array-key domain, see QueryLoadLevel).

TS cannot read the TC39 decorator context's field registrations at the
type level (no `emitDecoratorMetadata` in this repo — decision 0001), so
the map is the one declaration the author adds per model. The runtime
EntitySchema stays the source of truth: a key the map misses is rejected
by the runtime validation with the same descriptive error as before.
*/
export type DeclaredRelationships<C> = C extends {
  readonly neodeRelationships: infer R
}
  ? R extends Record<string, unknown>
    ? R
    : undefined
  : undefined

/**
The entity type a relationship field holds: the item of an array field
(`pets?: Pet[]` → Pet), else the field's own entity (`card?: Card` →
Card). Field types are the cardinality and target truth — the map only
distinguishes relationship keys from property keys.
*/
export type FieldTarget<T, K extends keyof T> =
  NonNullable<T[K]> extends (infer Item)[]
    ? Item
    : NonNullable<T[K]> extends object
      ? NonNullable<T[K]>
      : never

/**
Keys of T whose declared type can hold related entities: object or array
fields. The fallback (map-less) relationship-key domain — method keys and
primitive property keys are excluded from the domain. The NTS-154 map
entry refines this domain to the exactly declared relationships.
*/
export type RelationshipKeysOf<T> = {
  [K in keyof T & string]-?: T[K] extends (...arguments_: never[]) => unknown
    ? never
    : T[K] extends object | undefined
      ? K
      : never
}[keyof T & string]

/**
One nested level of a `with` load spec, keyed off the entity's DECLARED
FIELD types (no map entry required): the LoadOptions trim keys
(order / skip / limit / withoutFilters) sit beside the relationship keys,
exactly the object `parseLoadLevel` (NTS-498) reads at runtime — a
relationship named exactly like a reserved option key is unusable in the
spec, as the runtime reserves it.

Relationship keys descend recursively through the declared field types:
an array field loads many (`Item[]` in the narrowed return), an entity
field loads one (`Item | undefined`).
*/
export type QueryLoadLevel<T> = LoadOptions & {
  [K in RelationshipKeysOf<T> & string]?:
    | true
    | LoadSpec
    | (T[K] extends never ? never : K extends keyof T ? QueryLoadLevel<FieldTarget<T, K>> : never)
}

/**
The `with` load spec checked against the type-level model map (NTS-154),
keyed by the model CONSTRUCTOR:

- with a `neodeRelationships` phantom static: the spec's keys must be
  DECLARED RELATIONSHIPS (`keyof` the map entry, intersected with the
  class's own fields) — property keys, method keys and typos are type
  errors;
- without one: the inferred fallback domain (QueryLoadLevel) — keys whose
  declared field type can hold related entities.

Every level also accepts the LoadOptions trim keys and descends through
the declared field types, mirroring parseLoadLevel at runtime.
*/
export type QueryLoadSpec<C> =
  DeclaredRelationships<C> extends infer R
    ? R extends Record<string, unknown>
      ? C extends new (
          ...arguments_: never[]
        ) => infer T
        ? LoadOptions & {
            [K in keyof R & keyof T & string]?: true | LoadSpec | QueryLoadLevel<FieldTarget<T, K>>
          }
        : never
      : C extends new (
            ...arguments_: never[]
          ) => infer T2
        ? QueryLoadLevel<T2>
        : never
    : never

/**
The entity with the requested relationships of a `with` load spec loaded
(NTS-154): `T & { [loadedKey]: shape }`, where the shape follows the
runtime hydration contract (InstanceLoadLevel's materialized own
properties) — an array field loads `Item[]`, an entity field loads
`Item | undefined` (a one-key read with no related row yields undefined),
each recursed through the nested spec levels.

```ts
const user = await neode.find(Person, id, { with: { pets: { toys: true } } })
// Promise<(Person & { pets: (Pet & { toys: Toy[] })[] }) | undefined>
```

The LoadOptions trim keys (order / skip / limit / withoutFilters) inside
a spec level shape the read, not the result — they never appear in the
loaded shape, and a spec level that ONLY trims leaves the target's type
untouched (no empty intersection).
*/
type LoadedShape<T, W> = {
  // the mapping is guarded by the DECLARED relationship domain
  // (RelationshipKeysOf<T>): a key that slipped past the spec's
  // constraint check (constraint checks never excess-property-check) can
  // never fabricate a loaded claim — it resolves to plain T
  [K in Exclude<keyof W & string, keyof LoadOptions> & RelationshipKeysOf<T>]: K extends keyof T
    ? NonNullable<T[K]> extends (infer Item)[]
      ? W[K] extends Record<string, unknown>
        ? LoadedEntity<Item, W[K]>[]
        : Item[]
      : W[K] extends Record<string, unknown>
        ? LoadedEntity<NonNullable<T[K]>, W[K]> | undefined
        : NonNullable<T[K]> | undefined
    : never
}

export type LoadedEntity<T, W> = [W] extends [never]
  ? T
  : keyof LoadedShape<T, W> extends never
    ? T
    : T & LoadedShape<T, W>
