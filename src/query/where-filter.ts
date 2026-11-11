import type { Newable } from '../meta/newable.js'
import type { FieldTarget, RelationshipKeysOf } from './load-spec.js'

// ---------------------------------------------------------------------------
// Typed where filters (NTS-646, docs/decisions/0004-typed-where-filters.md)
// ---------------------------------------------------------------------------

/**
Keys of T holding method signatures — excluded from the filter key domain.
*/
type MethodKeys<T> = {
  [K in keyof T & string]-?: T[K] extends (...arguments_: never[]) => unknown ? K : never
}[keyof T & string]

/**
The declared property keys of an entity type: neither relationship keys
(the object/array field domain, RelationshipKeysOf) nor method keys.
*/
type PropertyKeys<T> = Exclude<keyof T & string, RelationshipKeysOf<T> | MethodKeys<T>>

/**
The operator-object tier of a filter operand (NTS-646): every operator
maps 1:1 onto a Builder method — eq/neq → where/whereNot, gt/gte/lt/lte →
where(prop, op, value), in → whereIn, contains/startsWith/endsWith →
whereContains/whereStartsWith/whereEndsWith, null → whereNull/whereNotNull.
No `between` (compose { gte, lte }), no `nin` (no Builder counterpart),
and no raw/alias-taking operators — those stay Builder-only.

The string operators type to `never` on non-string values, so
`{ age: { contains: 'x' } }` is a type error.
*/
export interface FilterOperators<V> {
  eq?: V
  neq?: V
  gt?: V
  gte?: V
  lt?: V
  lte?: V
  in?: V[]
  contains?: V extends string ? string : never
  startsWith?: V extends string ? string : never
  endsWith?: V extends string ? string : never
  null?: boolean
}

/**
One filter entry: a bare value (equality — today's bag, byte-identical
Cypher) or an operator object.
*/
export type FilterOperand<T, K extends keyof T & string> = T[K] | FilterOperators<NonNullable<T[K]>>

/**
One level of a where filter, keyed off the entity's DECLARED FIELD types:
property keys take bare values or operator objects, relationship keys
take nested filter bags (recursing through FieldTarget, the same descent
QueryLoadLevel uses). No phantom map required — a mis-filed key the
fallback domain lets through is caught by the runtime consumption loop.
*/
export type WhereFilterLevel<T> = {
  [K in PropertyKeys<T> & string]?: FilterOperand<T, K>
} & {
  [K in RelationshipKeysOf<T> & string]?: WhereFilterLevel<FieldTarget<T, K>>
}

/**
A where filter checked against the model's declared properties
(NTS-646), keyed by the model CONSTRUCTOR: equality values and operator
objects type-check against the declared property keys, relationship keys
take nested bags. Unknown keys — typos, method keys — are compile errors
at the call site (object-literal excess-property checking); a
`Record<string, unknown>` variable still passes (literals are the
contract), and the runtime helper throws on unknown operator keys.

```ts
await neode.get(Person, { name: 'Adam', age: { gte: 18 } })
await neode.get(Person, { pets: { kind: { startsWith: 'ca' } } })
await neode.get(Person, { nme: 'Adam' }) // ← compile error
```
*/
export type WhereFilter<C extends Newable> = C extends new (
  ...arguments_: never[]
) => infer T
  ? WhereFilterLevel<T>
  : never
