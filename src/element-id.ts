import { ELEMENT_ID } from './constants.js'
import type { EntitySchema } from './meta/entity/entity-schema.js'
import { PropertyType } from './meta/property-schema.js'

/**
The elementId carried by a hydrated entity: the runtime stash written by
hydration (every persisted entity has one), or the deprecated @InternalId
property for entities hydrated before it existed. Undefined for entities
that have never been persisted.

Leaf module on purpose: hydration, the active-record methods and the
service layer all read it, and none of them may import each other here.
*/
export function elementIdOfEntity(schema: EntitySchema, entity: object): string | undefined {
  const stashed: unknown = Reflect.get(entity, ELEMENT_ID)

  if (typeof stashed === 'string' && stashed.length > 0) {
    return stashed
  }

  const internalId = schema
    .getProperties()
    .find((property) => property.getType() === PropertyType.INTERNAL_ID)

  const viaProperty: unknown =
    internalId === undefined ? undefined : Reflect.get(entity, internalId.getKey())

  return typeof viaProperty === 'string' && viaProperty.length > 0 ? viaProperty : undefined
}
