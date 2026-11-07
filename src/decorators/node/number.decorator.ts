import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import type { PropertyConfig } from '../property-config.interface.js'
import { addRegistration, memberName } from '../registrations.js'

/**
Register a numeric (integer or float) property.
*/
export function Number(
  config: PropertyConfig = {},
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      // NUMBER (int/integer are the INTEGER spellings, see @Property and the map API)
      mergeProperty(constructor, propertyKey, PropertyType.NUMBER, config)
    })
  }
}
