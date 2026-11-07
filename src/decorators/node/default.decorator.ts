import { mergeProperty } from '../../meta/index.js'
import { PropertyType, type DefaultValue } from '../../meta/property-schema.js'
import { addRegistration, memberName } from '../registrations.js'

/**
Set a default value (literal or factory function) for the property.
Merges onto the existing property, so it can be stacked with a type decorator.
*/
export function Default(
  value: DefaultValue,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      mergeProperty(constructor, propertyKey, PropertyType.ANY, { default: value })
    })
  }
}
