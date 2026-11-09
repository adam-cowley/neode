import type { RelationshipCardinality } from '../../meta/relationship-property-schema.js'
import type { Newable } from '../../meta/newable.js'
import { Direction } from '../../query/index.js'
import { mergeRelationshipProperty } from '../../meta/index.js'
import { addRegistration, memberName } from '../registrations.js'

/**
Register a relationship property holding many related entities.
Positional form: target entity (lazy reference), relationship type
(omitted matches any type — the pattern renders type-less), direction
(default BOTH), eager loading, an agent-facing description,
per-relationship cascade and a write-time cardinality (NTS-161 — 'many'
by default; 'one' / 'zeroOrOne' restrict the relationship to a single
edge, a second relate() throwing CardinalityViolationError).
*/
export function OneToMany(
  entity: () => Newable,
  type?: string,
  direction?: Direction,
  isEager?: boolean,
  description?: string,
  isCascade?: boolean,
  cardinality?: RelationshipCardinality,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      // Merge Property Key
      mergeRelationshipProperty(
        constructor,
        propertyKey,
        type ?? '',
        entity,
        direction ?? Direction.BOTH,
        true,
        isEager,
        description,
        isCascade,
        cardinality,
      )
    })
  }
}
