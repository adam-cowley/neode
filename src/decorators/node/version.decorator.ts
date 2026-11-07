import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import { addRegistration, memberName } from '../registrations.js'

/**
Optimistic locking (NTS-158): mark the property as the model's version —
stamped 0 on create, incremented by 1 on every write addressed to the node,
and checked with `WHERE n.version = $expected` when the instance carries the
version it was hydrated with. A mismatch (the node changed underneath you)
throws `OptimisticLockError` — reload the entity and retry. Version is per
node only: writes reached through another node's save (nested relationship
targets) never bump it. Stack it with a type decorator (e.g. `@Number()`)
for a declared type. Merges onto the existing property, so it can be stacked.
*/
export function Version(): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      mergeProperty(constructor, propertyKey, PropertyType.ANY, { version: true })
    })
  }
}
