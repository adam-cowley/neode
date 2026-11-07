import type { VectorConfig } from '../../meta/schema-definition.interface.js'
import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import { addRegistration, memberName } from '../registrations.js'

/**
Declare a vector index over the property (NTS-447): `installSchema()` creates
the index with the deterministic `vectorIndexName()` naming, `dropSchema()`
drops it, and `knn()` searches it.
Merges onto the existing property, so it can be stacked with a type decorator.
*/
export function Vector(
  config: VectorConfig,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      mergeProperty(constructor, propertyKey, PropertyType.ANY, { vector: config })
    })
  }
}
