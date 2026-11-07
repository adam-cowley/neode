import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import { toDirection } from '../../query/index.js'
import type { RelationshipExistsConfig } from './projection-config.interface.js'
import { addRegistration, memberName } from '../registrations.js'

/**
NTS-137 — relationship existence projected as an inline `EXISTS { }`
boolean in the read query. `where` uses `node` as the variable convention
for the target node.

Example:
```ts
@RelationshipExists({ type: 'NEXT_LESSON', direction: 'out' })
hasNextLesson: boolean;
```
*/
export function RelationshipExists(
  config: RelationshipExistsConfig,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      const property = mergeProperty(constructor, propertyKey, PropertyType.RELATIONSHIP_EXISTS, {
        where: config.where,
      })

      property.setRelationshipType(config.type)
      property.setDirection(toDirection(config.direction))
    })
  }
}
