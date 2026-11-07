import { randomUUID } from 'node:crypto'
import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import type { PropertyConfig } from '../property-config.interface.js'
import { addRegistration, memberName } from '../registrations.js'

/**
Register a UUID property: validated as a UUID string, defaulting to a
random UUID v4 on create (an explicit `config.default` wins).
*/
export function Uuid(
  config: PropertyConfig = {},
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      const property = mergeProperty(constructor, propertyKey, PropertyType.UUID, config)

      // An explicit config default wins (parity with the map API's uuid handling)
      if (!Object.hasOwn(config, 'default')) {
        property.setDefaultValue(() => randomUUID())
      }
    })
  }
}
