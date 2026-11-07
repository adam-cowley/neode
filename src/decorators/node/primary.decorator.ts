import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import type { PropertyConfig } from '../property-config.interface.js'
import { addRegistration, memberName } from '../registrations.js'

/**
Mark the property as the model's primary key — Repository lookups and
save() match nodes on it. Merges onto the existing property, so it can
be stacked with a type decorator.
*/
export function Primary(
  config: PropertyConfig = {},
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      // Merge Property Key
      const property = mergeProperty(constructor, propertyKey, PropertyType.ANY, config)

      property.setPrimaryKey()
    })
  }
}
