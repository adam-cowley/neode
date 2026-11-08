import { mergeProperty } from '../../meta/index.js'
import type { Newable } from '../../meta/newable.js'
import { PropertyType } from '../../meta/property-schema.js'
import { toDirection } from '../../query/index.js'
import type { PropertyPathHop } from '../../meta/property-schema.js'
import type {
  CheckedPathRelatedConfig,
  CheckedRelatedConfig,
  PathRelatedConfig,
  RelatedConfig,
  RelatedPathHop,
} from './projection-config.interface.js'
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

NTS-547 — pass `path` instead of `type` for a multi-hop read: the hops are
chained in order and the LAST hop ends at the projected node. `fields` is
required with `path` (projected form only); a `target()` checks `fields`
against it and label-filters the final node.
*/
export function RelatedOne<T extends object>(
  config: CheckedRelatedConfig<T>,
): (value: undefined, context: ClassFieldDecoratorContext) => void
export function RelatedOne(
  config: RelatedConfig & { fields: string[]; target?: undefined },
): (value: undefined, context: ClassFieldDecoratorContext) => void
export function RelatedOne<T extends object>(
  config: CheckedPathRelatedConfig<T>,
): (value: undefined, context: ClassFieldDecoratorContext) => void
export function RelatedOne(
  config: { path: RelatedPathHop[]; fields: string[]; target?: undefined },
): (value: undefined, context: ClassFieldDecoratorContext) => void
export function RelatedOne(
  config: RelatedConfig | PathRelatedConfig | { path: RelatedPathHop[]; fields: string[] },
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

      // Multi-hop path (NTS-547): hops chained at render time; `type` and
      // top-level `direction` do not apply. The last hop ends at the
      // property's target — kept on the property so the final node is
      // label-filtered like a single-hop projection.
      if ('path' in config && config.path !== undefined) {
        if (config.fields === undefined || config.fields.length === 0) {
          throw new Error(`@RelatedOne on "${propertyKey}" with 'path' requires 'fields'`)
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

        const pathConfig = config as PathRelatedConfig
        const entity: Newable | undefined = pathConfig.target?.()

        if (entity !== undefined) {
          property.setEntity(entity)
        }

        return
      }

      property.setRelationshipType((config as RelatedConfig).type)
      property.setDirection(toDirection((config as RelatedConfig).direction))

      // With a field subset the target class is not needed for hydration;
      // without one it drives full-entity eager loading and is required
      // (standard decorators have no design:type reflection to infer it)
      const single = config as RelatedConfig
      const entity: Newable | undefined = single.target?.()

      if (entity === undefined && !single.fields) {
        throw new Error(`@RelatedOne on "${propertyKey}" requires either 'fields' or a 'target()'`)
      }

      if (entity !== undefined) {
        property.setEntity(entity)
      }
    })
  }
}
