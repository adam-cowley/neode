import { NeodeError } from '../errors/index.js'
import { mergeProperty } from '../meta/index.js'
import { PropertyType } from '../meta/property-schema.js'
import type { PropertyConfig } from './property-config.interface.js'
import { addRegistration, memberName } from './registrations.js'

const TYPE_ALIASES: Record<string, PropertyType> = {
  string: PropertyType.STRING,
  number: PropertyType.NUMBER,
  int: PropertyType.INTEGER,
  integer: PropertyType.INTEGER,
  float: PropertyType.FLOAT,
  boolean: PropertyType.BOOLEAN,
  uuid: PropertyType.UUID,
  date: PropertyType.DATE,
  time: PropertyType.TIME,
  datetime: PropertyType.DATETIME,
  localtime: PropertyType.LOCALTIME,
  localdatetime: PropertyType.LOCALDATETIME,
  point: PropertyType.POINT,
  duration: PropertyType.DURATION,
  any: PropertyType.ANY,
}

/**
Register a property with an explicit type and config, e.g.
`@Property({ type: 'string', index: true })`.
*/
export function Property(
  config: PropertyConfig = {},
): (value: undefined, context: ClassFieldDecoratorContext) => void {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    let type: PropertyType = PropertyType.ANY

    if (config.type !== undefined) {
      const mapped: PropertyType | undefined = TYPE_ALIASES[config.type]

      if (mapped === undefined) {
        throw new NeodeError(
          `Unknown property type "${config.type}". Valid types: ${Object.keys(TYPE_ALIASES).join(', ')}`,
        )
      }

      type = mapped
    }

    // Registration is deferred: the entity's class decorator replays it with
    // the real constructor (config.type is not a PropertySchema option, mergeProperty ignores it)
    addRegistration(context.metadata, (constructor) => {
      mergeProperty(constructor, propertyKey, type, config)
    })
  }
}
