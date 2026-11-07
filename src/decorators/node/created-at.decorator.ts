import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import { addRegistration, memberName } from '../registrations.js'

/**
Stamp the property server-side with `datetime()` once on create (NTS-165):
the database clock writes it, so clocks never drift across clients. Stack
it with a type decorator (e.g. `@DateTime()`) for a declared type.
Merges onto the existing property, so it can be stacked with a type decorator.
*/
export function CreatedAt(): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      mergeProperty(constructor, propertyKey, PropertyType.ANY, { createdAt: true })
    })
  }
}
