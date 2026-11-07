import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import { addRegistration, memberName } from '../registrations.js'

/**
NTS-138 — raw Cypher expression projected into the read query: the escape
hatch for graph context the projection builder cannot express yet. The
expression references the root node as `this`.

shortcut: the embedded Relate engine rejects pattern expressions (patterns
inside function calls, e.g. `size((this)-[:R]->())`) inside RETURN
projections — prefer @RelationshipCount (COUNT { }) there; plain Neo4j
accepts them. Upgrade when Relate lifts the restriction.

Example:
```ts
@Expression('size((this)-[:KNOWS]->())')
friendCount: number;
```
*/
export function Expression(
  expression: string,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      const property = mergeProperty(constructor, propertyKey, PropertyType.EXPRESSION, {})

      property.setExpression(expression)
    })
  }
}
