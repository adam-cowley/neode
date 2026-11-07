/**
Instance dirty tracking (NTS-157): a snapshot of the persisted scalar
property values a hydrated entity carries, diffed on write so `save()` /
`update()` only write what changed and a clean instance is a no-op.

Leaf module on purpose (like element-id.ts): hydration snapshots every
hydrated entity, the facade diffs inside save(), and the active-record
methods expose the Eloquent-style surface — none of them may import each
other here.

Only plain value properties are tracked, and never the graph:

- the primary key is identity, not state — it matches the node in the
  MERGE, it is never a written change (parity with UpdateService's guard)
- projected read-model values (NTS-135+) and relationship / node /
  internal-id properties are never snapshotted — relationships are
  written exclusively through the explicit relate()/detach() paths

The snapshots live in WeakMaps keyed by the entity instance: no shape
change, no enumerable keys, nothing leaks into serialisation.
*/
import type { EntitySchema } from './meta/entity/entity-schema.js'
import {
  NON_VALUE_TYPES,
  type PropertySchema,
  isProjectedProperty,
} from './meta/property-schema.js'

/**
Snapshotted persisted state per entity instance
*/
const SNAPSHOTS = new WeakMap<object, Record<string, unknown>>()

/**
Changes written by the entity instance's last save() / update()
*/
const LAST_CHANGES = new WeakMap<object, Record<string, unknown>>()

/**
The properties dirty tracking covers: plain persisted value properties —
everything the update path would write except the primary key
*/
function trackedProperties(schema: EntitySchema): PropertySchema[] {
  return schema
    .getProperties()
    .filter(
      (property) =>
        !property.isPrimaryKey() &&
        !isProjectedProperty(property) &&
        !NON_VALUE_TYPES.has(property.getType()),
    )
}

/**
Whether a value changed from a snapshot value: strict inequality for
scalars, element-wise for arrays (mutated-in-place lists are caught), and
NaN equals NaN (a stored NaN is not an endless dirty flag)
*/
function hasValueChanged(before: unknown, after: unknown): boolean {
  if (Number.isNaN(before) && Number.isNaN(after)) {
    return false
  }

  if (Array.isArray(before) || Array.isArray(after)) {
    return (
      !Array.isArray(before) ||
      !Array.isArray(after) ||
      before.length !== after.length ||
      before.some((value, index) => hasValueChanged(value, after[index]))
    )
  }

  return before !== after
}

/**
The tracked property values of an entity, read off `source`. Arrays are
copied: the snapshot must not alias the live value, or an in-place
mutation (push) would change the baseline with it and never read dirty.
*/
function values(schema: EntitySchema, source: object): Record<string, unknown> {
  const values: Record<string, unknown> = {}

  for (const property of trackedProperties(schema)) {
    const value: unknown = Reflect.get(source, property.getKey())

    // Array.isArray narrows to any[] — copy through a readonly unknown
    // view so the snapshot never aliases the live value
    values[property.getKey()] = Array.isArray(value) ? [...(value as readonly unknown[])] : value
  }

  return values
}

/**
Snapshot an entity's current tracked property values as the baseline its
dirty state diffs against
*/
export function snapshotEntity(schema: EntitySchema, entity: object): void {
  SNAPSHOTS.set(entity, values(schema, entity))
}

/**
True when the entity instance carries a snapshot (hydrated, or synced
after its own save/update)
*/
export function isTracked(entity: object): boolean {
  return SNAPSHOTS.has(entity)
}

/**
The keys whose current value differs from the persisted snapshot — empty
when the instance is clean or untracked
*/
export function diffDirty(schema: EntitySchema, entity: object): string[] {
  const snapshot = SNAPSHOTS.get(entity)

  return snapshot === undefined
    ? []
    : trackedProperties(schema)
        .map((property) => property.getKey())
        .filter((key) => hasValueChanged(snapshot[key], Reflect.get(entity, key)))
}

/**
The unsaved changes: dirty property key -> current value
*/
export function dirtyValues(schema: EntitySchema, entity: object): Record<string, unknown> {
  return Object.fromEntries(diffDirty(schema, entity).map((key) => [key, Reflect.get(entity, key)]))
}

/**
Record a completed write against `entity`: the changes it wrote (the diff
of the snapshot before the write against the persisted state in `after`,
the re-hydrated entity) become the wasChanged() state, and the snapshot
is refreshed to the persisted state.

`after` is undefined when the written node could not be re-found — the
stale snapshot is kept then: over-reporting dirty re-writes values,
under-reporting would drop the user's changes.
*/
export function recordSaved(schema: EntitySchema, entity: object, after: object | undefined): void {
  if (after === undefined) {
    return
  }

  const before = SNAPSHOTS.get(entity) ?? {}
  const changes: Record<string, unknown> = {}

  for (const property of trackedProperties(schema)) {
    const key = property.getKey()
    const value: unknown = Reflect.get(after, key)

    if (hasValueChanged(before[key], value)) {
      changes[key] = value
    }
  }

  LAST_CHANGES.set(entity, changes)
  SNAPSHOTS.set(entity, values(schema, after))
}

/**
Whether the instance's last save() / update() wrote changes — any (or the
given property key). Untracked instances and instances that have not
written since report false.
*/
export function wasChanged(entity: object, key?: string): boolean {
  const changes = LAST_CHANGES.get(entity)

  if (changes === undefined) {
    return false
  }

  return key === undefined ? Object.keys(changes).length > 0 : Object.hasOwn(changes, key)
}
