import type { Newable } from './meta/newable.js'
import { getModels } from './meta/index.js'
import { NeodeError } from './errors/index.js'

/**
The observer hooks a model can carry (NTS-511). before* hooks run before
the write statement — an error fails the write. On the facade
(`neode.save()` / `create()` / `delete()`) they run BEFORE the write's
transaction opens; on a transaction handle (`TransactionalService`) they
run inside it. after* hooks run once the write is COMMITTED (NTS-582): for
a write in an explicit or ambient transaction that is when the outermost
transaction commits — they never fire for work that rolls back or is
retried, and an error thrown by one cannot undo the committed write.

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
The model observer registry (NTS-511): observers registered per model
constructor, run at the facade and transaction write points.
*/
const registry = new Map<Newable, ModelObservers[]>()

/**
Register observers for a model (NTS-511). Returns the off function.
Unknown models throw — observers attach to registered models only.
*/
export function observe(model: Newable, observers: ModelObservers): () => void {
  if (!getModels().has(model)) {
    throw new NeodeError(
      'Cannot observe an unregistered model — register it with @NodeEntity / defineModel first',
    )
  }

  const set = registry.get(model) ?? []

  set.push(observers)
  registry.set(model, set)

  return () => {
    const current = registry.get(model) ?? []
    const index = current.indexOf(observers)

    if (index !== -1) {
      current.splice(index, 1)
    }
  }
}

/**
Run one hook for a model's observers, in registration order. An observer
error fails the write.
*/
export async function runObservers(
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
  const sets = registry.get(constructor as Newable) ?? []

  for (const observers of sets) {
    const hookFunction = observers[hook]

    if (hookFunction !== undefined) {
      // The registry is keyed per model; the caller passes that model's entity
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- per-model entity, narrowed by the registry key
      await hookFunction(entity as object, context)
    }
  }
}

/**
Test seam: drop every registered observer.
*/
export function clearObservers(): void {
  registry.clear()
}
