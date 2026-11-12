import { mergeRelationshipProperty } from '../../meta/index.js'
import type { RelationshipConfig } from '../relationship-config.interface.js'
import { addRegistration, memberName } from '../registrations.js'

/**
Register a relationship property holding one related entity. The target
entity (`config.target()`) is required — standard decorators have no
design:type reflection to infer it.
*/
export function OneToOne(
  config: RelationshipConfig,
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    // An explicit target() is now required: standard decorators have no
    // design:type reflection to infer the related entity
    addRegistration(context.metadata, (constructor) => {
      mergeRelationshipProperty(
        constructor,
        propertyKey,
        config.type,
        config.target(),
        config.direction,
        false,
        config.eager,
        config.description,
        config.cascade,
        config.cardinality,
        config.enforce,
      )
    })
  }
}
