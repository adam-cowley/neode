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

Config form (NTS-623, the README's documented shape — consistent with
@OneToOne and the projection decorators): the third argument is an object
carrying `direction`, `eager`, `description`, `cascade` and `cardinality`.
*/
export function OneToMany(
  entity: () => Newable,
  type?: string,
  directionOrConfig?:
    | Direction
    | {
        /**
        Relationship direction (default BOTH)
        */
        direction?: Direction
        /**
        Hydrate this relationship whenever the node is read
        */
        eager?: boolean
        /**
        Agent-facing description (NTS-445)
        */
        description?: string
        /**
        Per-relationship cascade mode
        */
        cascade?: boolean
        /**
        Write-time cardinality (NTS-161): 'many' (default), 'one' or 'zeroOrOne'
        */
        cardinality?: RelationshipCardinality
      },
  isEager?: boolean,
  description?: string,
  isCascade?: boolean,
  cardinality?: RelationshipCardinality,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)
    // `Direction` is a string union, so object is exactly the config form
    const config = typeof directionOrConfig === 'object' ? directionOrConfig : undefined
    const positionalDirection =
      typeof directionOrConfig === 'string' ? directionOrConfig : undefined
    const direction: Direction | undefined = config ? config.direction : positionalDirection
    const eager = config ? config.eager : isEager
    const relationshipDescription = config ? config.description : description
    const cascade = config ? config.cascade : isCascade
    const relationshipCardinality = config ? config.cardinality : cardinality

    addRegistration(context.metadata, (constructor) => {
      // Merge Property Key
      mergeRelationshipProperty(
        constructor,
        propertyKey,
        type ?? '',
        entity,
        direction ?? Direction.BOTH,
        true,
        eager,
        relationshipDescription,
        cascade,
        relationshipCardinality,
      )
    })
  }
}
