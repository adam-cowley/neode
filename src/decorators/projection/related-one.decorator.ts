import { mergeProperty } from '../../meta/index.js'
import type { Newable } from '../../meta/newable.js'
import { PropertyType } from '../../meta/property-schema.js'
import { toDirection } from '../../query/index.js'
import type { CheckedRelatedConfig, RelatedConfig } from './projection-config.interface.js'
import { addRegistration, memberName } from '../registrations.js'

/**
NTS-135 — eagerly load a related entity as a nested read-only DTO holding
only the named fields. Without `fields`, the full entity is eagerly loaded
(same behaviour as an eager @OneToOne, which then requires `target()`).

Example:
```ts
@RelatedOne({ type: 'IN_COURSE', direction: 'out', target: () => Course, fields: ['title', 'status'] })
course?: Pick<Course, 'title' | 'status'>
```

With a `target()`, `fields` is type-checked against the target's
properties. Without one, `fields` is unchecked (the unchecked overload).
*/
export function RelatedOne<T extends object>(
  config: CheckedRelatedConfig<T>,
): (value: undefined, context: ClassFieldDecoratorContext) => void
export function RelatedOne(
  config: RelatedConfig & { fields: string[]; target?: undefined },
): (value: undefined, context: ClassFieldDecoratorContext) => void
export function RelatedOne(
  config: RelatedConfig,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      const property = mergeProperty(
        constructor,
        propertyKey,
        PropertyType.RELATED_ONE,
        config.fields ? { fields: config.fields } : {},
      )

      property.setRelationshipType(config.type)
      property.setDirection(toDirection(config.direction))

      // With a field subset the target class is not needed for hydration;
      // without one it drives full-entity eager loading and is required
      // (standard decorators have no design:type reflection to infer it)
      const entity: Newable | undefined = config.target?.()

      if (entity === undefined && !config.fields) {
        throw new Error(`@RelatedOne on "${propertyKey}" requires either 'fields' or a 'target()'`)
      }

      if (entity !== undefined) {
        property.setEntity(entity)
      }
    })
  }
}
