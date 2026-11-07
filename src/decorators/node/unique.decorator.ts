import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import { addRegistration, memberName } from '../registrations.js'

/**
Mark the property as unique: installSchema() backs it with a uniqueness
constraint, and merge() treats races on it as constraint violations.
Merges onto the existing property, so it can be stacked with a type
decorator.
*/
export function Unique(): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      // Merge Property Key
      const property = mergeProperty(constructor, propertyKey, PropertyType.ANY)

      property.setUnique()
    })
  }
}
