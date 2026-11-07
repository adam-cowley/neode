import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import { addRegistration, memberName } from '../registrations.js'

/**
NTS-138 — derived field, computed in TypeScript after hydration from the
entity's projected fields. Never sent to the database.

Example:
```ts
@Computed((entity) => `${entity.firstName} ${entity.lastName}`)
fullName: string;
```
*/
export function Computed(
  compute: (entity: unknown) => unknown,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      const property = mergeProperty(constructor, propertyKey, PropertyType.COMPUTED, {})

      property.setCompute(compute)
    })
  }
}
