import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import { addRegistration, memberName } from '../registrations.js'

/**
NTS-137 — label predicate boolean: true when the node has the given label.

Example:
```ts
@LabelPresent('OptionalLesson')
isOptional: boolean;
```
*/
export function LabelPresent(
  label: string,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      const property = mergeProperty(constructor, propertyKey, PropertyType.LABEL_PRESENT, {})

      property.setLabel(label)
    })
  }
}
