import type { Newable } from './meta/newable.js'
import { getModels } from './meta/index.js'
import { getExtendedFrom } from './meta/map-schema.js'
import { NeodeError } from './errors/index.js'

/**
The observer hooks a model can carry (NTS-511). before* hooks run before
the write statement — an error fails the write. On the facade
(`neode.save()` / `create()` / `delete()`) they run BEFORE the write's
transaction opens; on a transaction handle (`TransactionalService`) they
run inside it. after* hooks run once the write is COMMITTED (NTS-582): for
a write in an explicit or ambient transaction that is when the outermost
transaction commits — they never fire for work that rolls back or is
retried, and an error thrown by one cannot undo the committed write. An
error an after* hook throws SURFACES AFTER THE COMMIT: it rejects the
point that flushes the buffered effects (the `transaction()` callback, the
managed scope, or the explicit `commit()` — or the facade call that
committed its own transaction), so the data stays committed while the
caller learns the hook failed (NTS-589).

On the create path beforeSave receives the plain properties record (the
entity does not exist yet) — mutate it to change what is written.
*/
export interface ModelObservers<Entity = object> {
  beforeSave?: (entity: Entity, context: ObserverContext) => void | Promise<void>
  afterSave?: (entity: Entity, context: ObserverContext) => void | Promise<void>
  beforeDelete?: (entity: Entity, context: ObserverContext) => void | Promise<void>
  afterDelete?: (entity: Entity, context: ObserverContext) => void | Promise<void>
}

/**
Hook context: whether this write creates the node (reliable on afterSave;
beforeSave on the save path sees false, on the create path true), and the
database the write targets.
*/
export interface ObserverContext {
  isNew: boolean
  database: string | undefined
}

/**
One model's observer registry (NTS-511 / NTS-596): observers registered
per Neode instance — `neode.observe()` registers here, and the instance's
write points look the hooks up here. A registry may chain a FALLBACK (the
module-global registry the standalone `observe()` function writes to), so
process-wide observers keep firing for every instance.

Lookup honors extended models: a model registered with extendModel() is a
CLONE of its base, so an observer on the base model fires for the clone's
entities too (the clone first, then its base).
*/
export class ObserverRegistry {
  private readonly sets = new Map<Newable, ModelObservers[]>()

  private readonly fallback: ObserverRegistry | undefined

  constructor(fallback?: ObserverRegistry) {
    this.fallback = fallback

    // Every live registry, so the clearObservers() test seam drops
    // instance-scoped registrations too (the registry references no
    // Neode, so this never keeps an instance alive)
    allRegistries.add(this)
  }

  /**
  Register observers for a model (NTS-511). Returns the off function.
  Unknown models throw — observers attach to registered models only.
  */
  observe(model: Newable, observers: ModelObservers): () => void {
    if (!getModels().has(model)) {
      throw new NeodeError(
        'Cannot observe an unregistered model — register it with @NodeEntity / defineModel first',
      )
    }

    const set = this.sets.get(model) ?? []

    set.push(observers)
    this.sets.set(model, set)

    return () => {
      const current = this.sets.get(model) ?? []
      const index = current.indexOf(observers)

      if (index !== -1) {
        current.splice(index, 1)
      }
    }
  }

  /**
  Run one hook for a model's observers, in registration order — the
  model's own observers first, then its extend() base's, then the
  fallback registry's. An observer error propagates to the caller.
  */
  async run(
    constructor: unknown,
    hook: keyof ModelObservers,
    entity: unknown,
    context: ObserverContext,
  ): Promise<void> {
    if (typeof constructor !== 'function') {
      return
    }

    // The caller passes the entity's own constructor (or its properties
    // record on the create path) — the registry key is that constructor
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowed by the typeof check above
    let model: Newable | undefined = constructor as Newable

    // Clone lineage (NTS-596): a clone is always freshly defined, so the
    // chain cannot cycle — the guard keeps a bad registration from hanging
    const walked = new Set<Newable>()

    while (model !== undefined && !walked.has(model)) {
      walked.add(model)

      const sets = this.sets.get(model) ?? []

      for (const observers of sets) {
        const hookFunction = observers[hook]

        if (hookFunction !== undefined) {
          // The registry is keyed per model; the caller passes that model's entity
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- per-model entity, narrowed by the registry key
          await hookFunction(entity as object, context)
        }
      }

      model = getExtendedFrom(model)
    }

    await this.fallback?.run(constructor, hook, entity, context)
  }

  /**
  Test seam: drop every observer in this registry.
  */
  clear(): void {
    this.sets.clear()
  }
}

/**
Every live registry, so the clearObservers() test seam drops
instance-scoped registrations too (a registry references no Neode, so
this never keeps an instance alive).
*/
const allRegistries = new Set<ObserverRegistry>()

/**
The module-global registry the standalone `observe()` function registers
into — every instance's lookup falls back to it, so process-wide
observers (and existing registrations through the function export) keep
firing (NTS-596).
*/
export const globalObservers = new ObserverRegistry()

/**
Register observers for a model process-wide (NTS-511). Returns the off
function. Every Neode instance fires process-wide observers; register
per-instance with `neode.observe()` instead to scope them to one
instance. Unknown models throw.
*/
export function observe(model: Newable, observers: ModelObservers): () => void {
  return globalObservers.observe(model, observers)
}

/**
Run one hook against the process-global registry (NTS-511).
*/
export async function runObservers(
  constructor: unknown,
  hook: keyof ModelObservers,
  entity: unknown,
  context: ObserverContext,
): Promise<void> {
  return globalObservers.run(constructor, hook, entity, context)
}

/**
Test seam: drop every registered observer — the process-global registry
AND every instance's (NTS-596).
*/
export function clearObservers(): void {
  for (const registry of allRegistries) {
    registry.clear()
  }
}
