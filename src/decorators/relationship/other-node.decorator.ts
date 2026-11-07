import type { Newable } from '../../meta/newable.js'
import { mergeProperty, mergeRelationshipModel } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import { addRegistration, memberName } from '../registrations.js'

/**
On a relationship entity: the property holding the node at the far end of
the relationship — the end node for an outgoing relationship, the start
node for an incoming one (the direction-agnostic alternative to
@EndNode / @StartNode).
*/
export function OtherNode(
  entity: () => Newable,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      mergeRelationshipModel(constructor)

      // Merge Property Key
      const property = mergeProperty(constructor, propertyKey, PropertyType.OTHER_NODE)

      property.setEntity(entity())
    })
  }
}
