import type { Newable } from '../../meta/newable.js'
import { mergeProperty, mergeRelationshipModel } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import { addRegistration, memberName } from '../registrations.js'

/**
On a relationship entity: the property holding the node at the
relationship's end.
*/
export function EndNode(
  entity: () => Newable,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      mergeRelationshipModel(constructor)

      // Merge Property Key
      const property = mergeProperty(constructor, propertyKey, PropertyType.END_NODE)

      property.setEntity(entity())
    })
  }
}
