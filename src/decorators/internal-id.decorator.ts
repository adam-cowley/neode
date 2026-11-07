import { mergeProperty } from '../meta/index.js'
import { PropertyType } from '../meta/property-schema.js'
import { addRegistration, memberName } from './registrations.js'

/**
Project the node's internal id (elementId) into the property — a
read-only structural field, not sent on writes.
*/
export function InternalId(): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      // Merge Property Key
      mergeProperty(constructor, propertyKey, PropertyType.INTERNAL_ID)
    })
  }
}
