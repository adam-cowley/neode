import { NeodeError } from '../../errors/index.js'
import { mergeProperty } from '../../meta/index.js'
import type { Newable } from '../../meta/newable.js'
import { PropertyType } from '../../meta/property-schema.js'
import { toDirection } from '../../query/index.js'
import type { PropertyPathHop } from '../../meta/property-schema.js'
import type {
  AnyRelatedConfig,
  CheckedPathRelatedConfig,
  CheckedRelatedConfig,
  RelatedConfig,
  RelatedPathHop,
} from './projection-config.interface.js'
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

With a `target()`, `fields` is type-checked against the target's
properties. Without one, `fields` is unchecked (the unchecked overload).

NTS-547 — pass `path` instead of `type` for a multi-hop read: the hops are
chained in order and the LAST hop ends at the projected node. `fields` is
required with `path` (projected form only); a `target()` checks `fields`
against it and label-filters the final node. End nodes reached through
several paths are deduplicated on hydration.
*/
export function RelatedMany<T extends object>(
  config: CheckedRelatedConfig<T> | CheckedPathRelatedConfig<T>,
): (value: undefined, context: ClassFieldDecoratorContext) => void
export function RelatedMany(
  config:
    | (RelatedConfig & { fields: string[]; target?: undefined })
    | { path: RelatedPathHop[]; fields: string[]; target?: undefined },
): (value: undefined, context: ClassFieldDecoratorContext) => void
export function RelatedMany(
  config: AnyRelatedConfig,
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

      // Multi-hop path (NTS-547): hops chained at render time; `type` and
      // top-level `direction` do not apply. The last hop ends at the
      // property's target — kept on the property so the final node is
      // label-filtered like a single-hop projection.
      if (config.path !== undefined) {
        if (config.fields === undefined || config.fields.length === 0) {
          throw new NeodeError(`@RelatedMany on "${propertyKey}" with 'path' requires 'fields'`)
        }

        property.setPath(
          config.path.map((hop) => {
            const normalised: PropertyPathHop = {
              type: hop.type,
              direction: toDirection(hop.direction),
            }

            if (hop.target !== undefined) {
              normalised.target = hop.target
            }

            return normalised
          }),
        )

        const pathEntity: Newable | undefined = config.target?.()

        if (pathEntity !== undefined) {
          property.setEntity(pathEntity)
        }

        if (config.where !== undefined) {
          property.setWhere(config.where)
        }

        return
      }

      property.setRelationshipType(config.type ?? '')
      property.setDirection(toDirection(config.direction))

      if (config.where !== undefined) {
        property.setWhere(config.where)
      }

      const entity: Newable | undefined = config.target?.()

      if (entity === undefined && !config.fields) {
        throw new NeodeError(
          `@RelatedMany on "${propertyKey}" requires either 'fields' or a 'target()'`,
        )
      }

      if (entity !== undefined) {
        property.setEntity(entity)
      }
    })
  }
}
