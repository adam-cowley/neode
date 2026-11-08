import { warnDeprecated } from '../../deprecate.js'
import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import type { PropertyConfig } from '../property-config.interface.js'
import { addRegistration, memberName } from '../registrations.js'

/**
Register a string property.

@deprecated Use `@Property({ type: 'string' })` instead — `@String` shadows the global `String` type.
*/
export function String(
  config?: PropertyConfig,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  warnDeprecated('@String', "@Property({ type: 'string' })")
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      // Merge Property Key
      mergeProperty(constructor, propertyKey, PropertyType.STRING, config)
    })
  }
}
