import type { Newable } from '../../meta/newable.js'
import { Direction } from '../../query/index.js'
import { mergeRelationshipProperty } from '../../meta/index.js'
import { addRegistration, memberName } from '../registrations.js'

export function OneToMany(
  entity: () => Newable,
  type?: string,
  direction?: Direction,
  isEager?: boolean,
  description?: string,
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
      )
    })
  }
}
