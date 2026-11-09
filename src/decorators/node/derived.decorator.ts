import type { DerivedConfig } from '../../meta/schema-definition.interface.js'
import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import { addRegistration, memberName } from '../registrations.js'

/**
Stored derived property (NTS-569): computed on the write path from the
`from` source properties and stored like a hand-set value — the write-time
counterpart of `@Computed` (read-time, never stored).

TypeScript-side (`compute`) runs against the entity's property record;
Cypher-side (`cypher`) is evaluated by the database inside the write
statement with `this` bound to the written node after the sources are set.
Exactly one of the two is required. A write touching any source recomputes
the value unless the derived property itself is explicitly provided.

Example:
```ts
@Property({ type: 'duration' })
@Derived({
  from: ['orderDate', 'shippedDate'],
  cypher: 'duration.between(this.orderDate, this.shippedDate)',
})
timeToShip!: unknown;
```

Merges onto the existing property, so it can be stacked with a type
decorator.
*/
export function Derived(
  config: DerivedConfig,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      mergeProperty(constructor, propertyKey, PropertyType.ANY, { derived: config })
    })
  }
}
