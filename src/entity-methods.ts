/**
Active-record style instance methods for hydrated entities (P7.2).

Hydrated entities get `save()`, `update()`, `delete()`, `relateTo()` and
`detachFrom()` on their PROTOTYPE (wired once per entity constructor at
first hydration, see applyEntityMethods) so instances behave like neode's
Node without needing the Neode instance in scope.

The methods need a Neode instance. Hydration has no access to the Neode
performing the query (QueryService hands it only schemas and classes), so
methods resolve a module-level default at call time. Set it explicitly
with setDefaultNeode(); the most recently set instance wins.
*/

import type { GraphRelationship } from './driver/types.js'
import { elementIdOfEntity } from './element-id.js'
import {
  dirtyValues,
  diffDirty,
  isTracked,
  recordSaved,
  wasChanged as wasChangedState,
} from './dirty.js'
import { getModel } from './meta/index.js'
import type { EntitySchema } from './meta/entity/entity-schema.js'
import type { Newable } from './meta/newable.js'
import type { Neode } from './neode.service.js'
import { toJson } from './serialise.js'
import type {
  LoadOptions,
  RelatedQuery,
  RelatedScope,
} from './services/query/load-relation.service.js'
import type { DeleteOptions } from './services/query/delete.service.js'
import type { DetachResult } from './services/query/detach.service.js'
import { constructorOf as constructorOfInstance } from './services/type-guards.js'
import { quote } from './query/quote.js'

/**
The Neode instance that entity instance methods operate against, held in
an object so no module-level binding is ever reassigned from a function.

shortcut: last-set-wins — multiple Neode instances cannot be addressed
from instance methods; upgrade by threading the instance through hydration.
*/
const defaultNeodeHolder: { neode: Neode | undefined } = { neode: undefined }

/**
Set the Neode instance used by entity instance methods
(`person.save()`, `person.relateTo(...)`, ...).
*/
export function setDefaultNeode(neode: Neode): void {
  defaultNeodeHolder.neode = neode
}

function requireNeode(): Neode {
  const neode = defaultNeodeHolder.neode

  if (neode === undefined) {
    throw new Error(
      'No Neode instance available for entity instance methods — call setDefaultNeode(neode) first',
    )
  }

  return neode
}

/**
The constructor of an entity instance — always defined for class
instances, but the guard keeps the unknown boundary checked.
*/
function requireConstructor(entity: object): Newable {
  const found = constructorOfInstance(entity)

  if (found === undefined) {
    throw new Error('Entity has no constructor — cannot resolve its model')
  }

  return found
}

/**
The model schema of an entity instance, or undefined when the value is
not a registered model — the dirty-tracking surface reports "not dirty"
for unregistered values instead of throwing
*/
function schemaOf(entity: object): EntitySchema | undefined {
  return getModel(constructorOfInstance(entity))
}

/**
The elementId of a hydrated entity
*/
function elementIdOf(entity: object): string {
  const constructor: unknown = requireConstructor(entity)
  const schema = getModel(constructor)

  if (schema === undefined) {
    throw new Error('Entity is not a registered model — cannot resolve its elementId')
  }

  const elementId = elementIdOfEntity(schema, entity)

  if (elementId === undefined) {
    throw new Error('Entity has no elementId — save() it before changing its labels')
  }

  return elementId
}

/**
SET / REMOVE a label on the node matched by elementId (autocommit — labels
cannot be parameterised), then re-hydrate the entity in place
*/
async function changeLabel(entity: object, label: string, verb: 'SET' | 'REMOVE'): Promise<object> {
  const neode = requireNeode()
  const elementId = elementIdOf(entity)

  await neode.writeCypher(`MATCH (n) WHERE elementId(n) = $elementId ${verb} n:${quote(label)}`, {
    elementId,
  })

  const hydrated = await neode.findById(requireConstructor(entity), elementId)

  if (hydrated !== undefined && hydrated !== null) {
    // The re-hydrated state is the persisted state — re-baseline the
    // dirty tracking before it lands on the instance (NTS-157)
    const schema = schemaOf(entity)

    if (schema !== undefined) {
      recordSaved(schema, entity, hydrated)
    }

    Object.assign(entity, hydrated)
  }

  return entity
}

/**
The per-instance load spec (NTS-498): relationship key -> request. A key's
value is `true` (load all), a LoadOptions object (order / skip / limit /
withoutFilters — the NTS-558 options), or a nested spec object one more
level down the declared relationship graph (`person.load({ pets: { toys:
true } })`).

The four option keys are reserved at every level: a relationship named
exactly `order`, `skip`, `limit` or `withoutFilters` cannot be
nested-loaded through the spec — the single-key load(key) form still
reaches it.

shortcut: without the NTS-154 model map the key domain is every
non-method key of the entity type — plain property keys and
relationship-entity keys type-check here and the runtime rejects them,
naming the declared relationships at that level.
*/
export type InstanceLoadLevel<T> = {
  [K in Exclude<keyof T, keyof EntityMethods> & string]?:
    | true
    | LoadOptions
    | (T[K] extends (infer Item)[]
        ? InstanceLoadLevel<Item>
        : T[K] extends object
          ? InstanceLoadLevel<NonNullable<T[K]>>
          : never)
}

/**
The methods wired onto hydrated entities. Uses polymorphic `this` so
`WithMethods<Person>` chains as `Promise<WithMethods<Person>>`.
*/
export interface EntityMethods {
  /**
  MERGE this entity, then re-hydrate the persisted state onto it
  */
  save(): Promise<this>

  /**
  `+=` update the given properties, then re-hydrate onto this entity
  */
  update(properties?: Record<string, unknown>): Promise<this>

  /**
  Delete this node from the graph (cascade options as in neode.delete).
  With `{ soft: label }` the label is SET instead and the refreshed
  entity is returned; without it the node is deleted and the same
  (detached) instance is returned.
  */
  delete(options?: DeleteOptions | string): Promise<this>

  /**
  Add a label to this node's state (SET n:Label) and re-hydrate
  */
  addLabel(label: string): Promise<this>

  /**
  Remove a label from this node's state (REMOVE n:Label) and re-hydrate
  */
  removeLabel(label: string): Promise<this>

  /**
  Relate this entity to another saved entity, resolving the
  relationship by its key on this entity's schema
  */
  relateTo(
    other: object,
    relationshipKey: string,
    properties?: Record<string, unknown>,
    shouldForceCreate?: boolean,
  ): Promise<GraphRelationship | undefined>

  /**
  Remove the relationship of the given key between this entity and other
  */
  detachFrom<To extends object>(other: To, relationshipKey: string): Promise<DetachResult<this, To>>

  /**
  Lazy-load one relationship in place (NTS-558) — the loader the
  RelationNotLoadedError message promises. Traverses the declared
  relationship, hydrates the related entities through the regular
  hydration path, and materializes the result as an own property so
  strict relation access (NTS-155) reads it back without throwing.

  `options` pushes order/skip/limit into the traversal's ORDER BY /
  LIMIT — the sorted, truncated related reads otherwise needing a raw
  Builder. Many-keys resolve to the loaded entities, one-keys to the
  entity or undefined.
  */
  load<K extends Exclude<keyof this, keyof EntityMethods> & string>(
    key: K,
    options?: LoadOptions,
  ): Promise<this[K]>

  /**
  Load SEVERAL relationships in place, per query, with per-level
  constraints (NTS-498): the spec's keys name declared relationships —
  `true` loads all, an object carries that level's traversal options
  (order / skip / limit / withoutFilters) mixed with nested spec keys one
  level down. One read per root key; nested levels ride that statement's
  projection, so they never N+1 per entity. The loaded values
  materialize as own properties per key (the NTS-155 accessor contract).
  */
  load(spec: InstanceLoadLevel<this>): Promise<void>

  /**
  Query FROM this entity along a declared relationship key (NTS-497) —
  the queryable generalisation of load(): Builder-style verbs (where /
  orderBy / limit / skip) composed on top of the relationship traversal,
  with the terminal find() / first() / count() running the composed
  statement and hydrating the related entities through the regular
  hydration path. The related target's own global filters (NTS-162)
  apply inside the traversal read — a filtered-out target yields an
  empty result, never an error.

  The scope's target type narrows from the relationship declaration: a
  many-key scopes to the declared entity array's item, a one-key to the
  declared entity.
  */
  related<K extends Exclude<keyof this, keyof EntityMethods> & string>(
    key: K,
  ): RelatedScope<this[K] extends (infer Item)[] ? Item : NonNullable<this[K]>, this[K]>

  /**
  Whether the instance has unsaved changes — any (or, with `key`, the
  given property key) since its last persisted snapshot (Eloquent-style
  dirty tracking, NTS-157). Instances that have never been hydrated or
  saved report false.
  */
  isDirty(key?: string): boolean

  /**
  The unsaved changes: dirty property key -> current value. The primary
  key is identity, not state, and relationship keys never appear —
  relationships are written through relate()/detach().
  */
  getDirty(): Record<string, unknown>

  /**
  Whether the instance's last save() / update() wrote changes — any (or,
  with `key`, the given property key)
  */
  wasChanged(key?: string): boolean

  /**
  JSON-safe serialisation of this entity (properties, labels, elementId)
  */
  toJson(): Record<string, unknown>
}

/**
Type helper for entity instances: `WithMethods<Person>` adds the
instance methods to a user class. Runtime works on hydrated instances
regardless — this is only for type-checking, since declaration merging
onto arbitrary user classes is not possible.
*/
export type WithMethods<T> = T & EntityMethods

/**
The runtime implementations (this-typed, attached to the prototype)
*/
interface MethodImpl {
  save(this: object): Promise<object>
  update(this: object, properties?: Record<string, unknown>): Promise<object>
  delete(this: object, options?: DeleteOptions | string): Promise<object>
  addLabel(this: object, label: string): Promise<object>
  removeLabel(this: object, label: string): Promise<object>
  isDirty(this: object, key?: string): boolean
  getDirty(this: object): Record<string, unknown>
  wasChanged(this: object, key?: string): boolean
  toJson(this: object): Record<string, unknown>
  relateTo(
    this: object,
    other: object,
    relationshipKey: string,
    properties?: Record<string, unknown>,
    shouldForceCreate?: boolean,
  ): Promise<GraphRelationship | undefined>
  detachFrom(
    this: object,
    other: object,
    relationshipKey: string,
  ): Promise<DetachResult<object, object>>
  load(this: object, keyOrSpec: string | object, options?: LoadOptions): Promise<unknown>
  related(this: object, key: string): RelatedQuery
}

const methods: MethodImpl = {
  async save(this) {
    const saved = await requireNeode().save(this)

    // Re-baseline the dirty state against the persisted state before the
    // re-hydrated values land on the instance (NTS-157)
    const schema = schemaOf(this)

    if (schema !== undefined) {
      recordSaved(schema, this, saved)
    }

    return Object.assign(this, saved)
  },

  toJson(this) {
    return toJson(this)
  },

  async update(this, properties) {
    const schema = schemaOf(this)

    // No properties given: flush the instance's own dirty state — a
    // no-op (no query) when clean (NTS-157). Untracked instances keep
    // the legacy no-argument behaviour (required-property refill).
    const shouldFlushDirty = properties === undefined && schema !== undefined && isTracked(this)

    if (shouldFlushDirty && diffDirty(schema, this).length === 0) {
      return this
    }

    const hydrated = await requireNeode().update(
      this,
      shouldFlushDirty ? dirtyValues(schema, this) : (properties ?? {}),
    )

    if (hydrated !== undefined) {
      if (schema !== undefined) {
        recordSaved(schema, this, hydrated)
      }

      Object.assign(this, hydrated)
    }

    return this
  },

  async delete(this, options) {
    const soft = typeof options === 'object' ? options.soft : undefined

    // Labels-as-state: SET the soft-delete label instead of deleting,
    // returning the refreshed entity
    if (soft !== undefined && soft !== '') {
      return changeLabel(this, soft, 'SET')
    }

    await requireNeode().delete(this, options)

    return this
  },

  async addLabel(this, label) {
    return changeLabel(this, label, 'SET')
  },

  async removeLabel(this, label) {
    return changeLabel(this, label, 'REMOVE')
  },

  async relateTo(this, other, relationshipKey, properties = {}, shouldForceCreate = false) {
    return requireNeode().relate(
      requireConstructor(this),
      this,
      other,
      relationshipKey,
      properties,
      shouldForceCreate,
    )
  },

  async detachFrom(this, other, relationshipKey) {
    return requireNeode().detach(requireConstructor(this), this, other, relationshipKey)
  },

  async load(this: object, keyOrSpec: string | object, options?: LoadOptions): Promise<unknown> {
    return typeof keyOrSpec === 'string'
      ? requireNeode().loadRelation(requireConstructor(this), this, keyOrSpec, options)
      : requireNeode().loadRelationSpec(requireConstructor(this), this, keyOrSpec)
  },

  related(this, key) {
    return requireNeode().relatedQuery(requireConstructor(this), this, key)
  },

  isDirty(this, key) {
    const schema = schemaOf(this)

    if (schema === undefined || !isTracked(this)) {
      return false
    }

    const dirty = diffDirty(schema, this)

    return key === undefined ? dirty.length > 0 : dirty.includes(key)
  },

  getDirty(this) {
    const schema = schemaOf(this)

    return schema === undefined || !isTracked(this) ? {} : dirtyValues(schema, this)
  },

  wasChanged(this, key) {
    return wasChangedState(this, key)
  },
}

const METHODS_APPLIED = Symbol('neode:entity-methods-applied')

/**
The prototype a class's methods are defined on. Constructor types expose
it as `any` — the runtime check is the checked edge.
*/
function prototypeOf(constructor: Newable): object {
  const prototype: unknown = constructor.prototype

  if (typeof prototype !== 'object' || prototype === null) {
    throw new TypeError('applyEntityMethods expects a class constructor')
  }

  return prototype
}

/**
Wire the instance methods onto an entity class's PROTOTYPE (idempotent:
applied once per constructor, at first hydration or by explicit call).
Methods the user class already defines are left untouched.
*/
export function applyEntityMethods(constructor: Newable, neode?: Neode): void {
  if (neode !== undefined) {
    setDefaultNeode(neode)
  }

  const prototype = prototypeOf(constructor)

  if (Object.hasOwn(prototype, METHODS_APPLIED)) {
    return
  }

  for (const [name, function_] of Object.entries(methods)) {
    // A user-defined method wins — partial adoption, no clobbering
    if (Reflect.has(prototype, name)) {
      continue
    }

    Object.defineProperty(prototype, name, {
      value: function_,
      enumerable: false,
      writable: true,
      configurable: true,
    })
  }

  Object.defineProperty(prototype, METHODS_APPLIED, {
    value: true,
    enumerable: false,
  })
}
