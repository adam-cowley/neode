import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import { toDirection } from '../../query/index.js'
import type { RelationshipCountConfig } from './projection-config.interface.js'
import { addRegistration, memberName } from '../registrations.js'

/**
NTS-136 — relationship count projected as an inline `COUNT { }` subquery
in the read query (TypeORM @RelationCount parity): one query per read,
no N+1. Multi-type counts use a pipe: `type: 'HAS_MODULE|HAS_LESSON'`.

Example:
```ts
@RelationshipCount({ type: 'COMPLETED_LESSON', direction: 'out', where: 'NOT node:OptionalLesson' })
requiredLessonsCount: number;
```
*/
export function RelationshipCount(
  config: RelationshipCountConfig,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      const property = mergeProperty(constructor, propertyKey, PropertyType.RELATIONSHIP_COUNT, {
        where: config.where,
        minHops: config.minHops,
        maxHops: config.maxHops,
      })

      property.setRelationshipType(config.type)
      property.setDirection(toDirection(config.direction))

      // Optional: labels of the counted node
      if (config.target) {
        property.setEntity(config.target())
      }
    })
  }
}
