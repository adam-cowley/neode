import type { Newable } from '../../meta/newable.js'
import { mergeRelationshipModel } from '../../meta/index.js'
import { getRegistrations } from '../registrations.js'

export function RelationshipEntity(): (
  constructor: Newable,
  context: ClassDecoratorContext,
) => void {
  return function (constructor: Newable, context: ClassDecoratorContext): void {
    // Replay field registrations queued by property decorators (from the
    // decorator context — the metadata is attached to the class only after
    // this decorator returns)
    for (const registration of getRegistrations(context.metadata)) {
      registration(constructor)
    }

    // Merge Model into map or update the type to relationship
    mergeRelationshipModel(constructor)
  }
}
