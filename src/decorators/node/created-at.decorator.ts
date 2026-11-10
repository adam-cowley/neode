import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import type { TimestampConfig } from '../property-config.interface.js'
import { addRegistration, memberName } from '../registrations.js'

/**
Stamp the property server-side with `datetime()` once on create (NTS-165):
the database clock writes it, so clocks never drift across clients.
`{ format: 'iso-string' }` stamps `toString(datetime())` instead — an
ISO-8601 string that compares lexically against client-supplied timestamps
(NTS-612). Stack it with a type decorator (e.g. `@String()` for the
iso-string form, `@DateTime()` for the temporal) for a declared type.
Merges onto the existing property, so it can be stacked with a type decorator.
*/
export function CreatedAt(
  config: TimestampConfig = {},
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      mergeProperty(constructor, propertyKey, PropertyType.ANY, {
        createdAt: true,
        ...(config.format !== undefined && { timestampFormat: config.format }),
      })
    })
  }
}
