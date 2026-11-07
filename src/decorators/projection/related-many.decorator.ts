import { mergeProperty } from '../../meta/index.js'
import type { Newable } from '../../meta/newable.js'
import { PropertyType } from '../../meta/property-schema.js'
import { toDirection } from '../../query/index.js'
import type { RelatedConfig } from './projection-config.interface.js'
import { addRegistration, memberName } from '../registrations.js'

/**
NTS-135 — eagerly load related entities as a read-only list. With a field
subset the result is projected flat: a single field yields a scalar array
(`completedLessons: string[]`), several fields an array of plain DTOs.
Without `fields`, full entities are eagerly loaded (same behaviour as an
eager @OneToMany, which then requires `target()`).

Example:
```ts
@RelatedMany({ type: 'COMPLETED_LESSON', fields: ['slug'] })
completedLessons: string[];
```
*/
export function RelatedMany(
  config: RelatedConfig,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      const property = mergeProperty(
        constructor,
        propertyKey,
        PropertyType.RELATED_MANY,
        config.fields ? { fields: config.fields } : {},
      )

      property.setRelationshipType(config.type)
      property.setDirection(toDirection(config.direction))

      const entity: Newable | undefined = config.target?.()

      if (entity === undefined && !config.fields) {
        throw new Error(`@RelatedMany on "${propertyKey}" requires either 'fields' or a 'target()'`)
      }

      if (entity !== undefined) {
        property.setEntity(entity)
      }
    })
  }
}
