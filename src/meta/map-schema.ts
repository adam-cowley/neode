import { randomUUID } from 'node:crypto'

import { mergeModel, mergeProperty, mergeRelationshipProperty, METAMODEL_KEYS } from './index.js'
import { NeodeError } from '../errors/index.js'
import type { Newable } from './newable.js'
import { PropertySchema, PropertyType } from './property-schema.js'
import { toDirection } from '../query/index.js'
import { isRecord } from '../services/type-guards.js'
import type {
  ProjectionDefinition,
  PropertyDefinition,
  PropertyTypeName,
  RelatedOneDefinition,
  RelatedManyDefinition,
  RelationshipCountDefinition,
  RelationshipDefinition,
  RelationshipExistsDefinition,
  SchemaDefinition,
} from './schema-definition.interface.js'

/**
neode's Model.js RELATIONSHIP_TYPES — keys that define a relationship
*/
const RELATIONSHIP_TYPES = new Set(['relationship', 'relationships', 'node', 'nodes'])

/**
Definition `type` values that define a projected read-model property
*/
const PROJECTION_TYPES = new Set([
  'relatedOne',
  'relatedMany',
  'relationshipCount',
  'relationshipExists',
  'labelPresent',
  'expression',
  'computed',
])

// Keyed openly: map definitions may name types the table does not know
// (unknown names fall back to ANY, neode parity)
export const PROPERTY_TYPES: Record<string, PropertyType | undefined> = {
  any: PropertyType.ANY,
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
}

/**
Name index over the shared models registry
*/
const modelsByName = new Map<string, Newable>()

/**
Name index of the original definitions, kept for extendModel cloning
*/
const definitionsByName = new Map<string, SchemaDefinition>()

/**
Clone lineage (NTS-596): extend() clone constructor -> the base model
constructor it was cloned from
*/
const extendedFrom = new Map<Newable, Newable>()

/**
Relationship definitions whose target model was not yet defined
*/
interface PendingRelationship {
  constructor: Newable
  key: string
  definition: RelationshipDefinition
}

const pendingRelationships: PendingRelationship[] = []

/**
Projection definitions whose target model was not yet defined
*/
interface PendingProjection {
  constructor: Newable
  key: string
  definition: ProjectionDefinition
}

const pendingProjections: PendingProjection[] = []

/**
A virtual entity class for map-defined models. Instances hydrate and
resolve back through the shared registry like decorator-defined classes
(`new constructor()` → `.constructor` finds the EntitySchema).
*/
function virtualConstructor(name: string): Newable {
  const Virtual = class {
    // Instances hydrate through the metamodel; the declaration only marks
    // the class non-empty for the no-extraneous-class rule
    declare readonly __virtualModel?: undefined
  }

  Object.defineProperty(Virtual, 'name', { value: name })

  return Virtual
}

function isRelationshipDefinition(value: unknown): value is RelationshipDefinition {
  return (
    isRecord(value) && typeof value['type'] === 'string' && RELATIONSHIP_TYPES.has(value['type'])
  )
}

function isProjectionDefinition(value: unknown): value is ProjectionDefinition {
  return isRecord(value) && typeof value['type'] === 'string' && PROJECTION_TYPES.has(value['type'])
}

function isPropertyDefinition(value: unknown): value is PropertyDefinition {
  return isRecord(value) && typeof value['type'] === 'string'
}

/**
Register a projected read-model property from its map definition
*/
function wireProjectionProperty(
  constructor: Newable,
  key: string,
  definition: ProjectionDefinition,
  target?: Newable,
): void {
  const PROJECTION_PROPERTY_TYPES: Record<ProjectionDefinition['type'], PropertyType> = {
    relatedOne: PropertyType.RELATED_ONE,
    relatedMany: PropertyType.RELATED_MANY,
    relationshipCount: PropertyType.RELATIONSHIP_COUNT,
    relationshipExists: PropertyType.RELATIONSHIP_EXISTS,
    labelPresent: PropertyType.LABEL_PRESENT,
    expression: PropertyType.EXPRESSION,
    computed: PropertyType.COMPUTED,
  }

  const property = mergeProperty(constructor, key, PROJECTION_PROPERTY_TYPES[definition.type], {})

  switch (definition.type) {
    case 'relatedOne':
    case 'relatedMany': {
      const related: RelatedOneDefinition | RelatedManyDefinition = definition

      if (related.fields) {
        property.setFields(related.fields)
      }
      property.setRelationshipType(related.relationship)
      property.setDirection(toDirection(related.direction))
      if (target) {
        property.setEntity(target)
      }
      break
    }

    case 'relationshipCount': {
      const count: RelationshipCountDefinition = definition

      property.setRelationshipType(count.relationship)
      property.setDirection(toDirection(count.direction))
      if (count.where !== undefined && count.where !== '') {
        property.setWhere(count.where)
      }
      if (count.minHops !== undefined) {
        property.setMinHops(count.minHops)
      }
      if (count.maxHops !== undefined) {
        property.setMaxHops(count.maxHops)
      }
      if (target) {
        property.setEntity(target)
      }
      break
    }

    case 'relationshipExists': {
      const exists: RelationshipExistsDefinition = definition

      property.setRelationshipType(exists.relationship)
      property.setDirection(toDirection(exists.direction))
      if (exists.where !== undefined && exists.where !== '') {
        property.setWhere(exists.where)
      }
      break
    }

    case 'labelPresent': {
      property.setLabel(definition.label)
      break
    }

    case 'expression': {
      property.setExpression(definition.expression)
      break
    }

    case 'computed': {
      property.setCompute(definition.compute)
      break
    }
  }
}

function definePropertyModel(
  constructor: Newable,
  key: string,
  definition: PropertyDefinition | string | string[],
): PropertySchema {
  let full: PropertyDefinition | { type: string }

  if (typeof definition === 'string') {
    full = { type: definition }
  } else if (isPropertyDefinition(definition)) {
    full = definition
  } else {
    // Not a definition shape (e.g. a stray array): falls through to ANY
    full = { type: 'any' }
  }

  // uuid properties generate a uuid by default (parity with the @Uuid decorator)
  if (full.type === 'uuid' && !Object.hasOwn(full, 'default')) {
    return mergeProperty(constructor, key, PropertyType.UUID, {
      ...full,
      default: () => randomUUID(),
    })
  }

  return mergeProperty(constructor, key, PROPERTY_TYPES[full.type] ?? PropertyType.ANY, full)
}

/**
Build the declared edge-property schemas of a relationship (NTS-628):
the map API's `properties` key. Values validate like property maps —
same type table, same rule keys.
*/
function edgePropertySchemas(
  declared: Record<string, PropertyTypeName | PropertyDefinition>,
): PropertySchema[] {
  return Object.entries(declared).map(([name, definition]) => {
    const full: PropertyDefinition =
      typeof definition === 'string' ? { type: definition } : definition

    const property = new PropertySchema(name)

    property.setType(PROPERTY_TYPES[full.type] ?? PropertyType.ANY)

    if (full.array === true) {
      property.setArray(true)
    }

    if (full.required === true) {
      property.setRequired(true)
    }

    // Every config key the metamodel has no flag for is a validation rule
    // (mergeProperty parity)
    property.setRules(
      Object.fromEntries(Object.entries(full).filter(([key]) => !METAMODEL_KEYS.has(key))),
    )

    return property
  })
}

function wireRelationshipModel(
  constructor: Newable,
  key: string,
  definition: RelationshipDefinition,
  target: Newable,
): void {
  const relationship = mergeRelationshipProperty(
    constructor,
    key,
    definition.relationship,
    target,
    toDirection(definition.direction),
    definition.type === 'relationships' || definition.type === 'nodes',
    definition.eager,
    definition.description,
    definition.cascade,
    definition.cardinality,
    definition.enforce,
    definition.claimConflict,
  )

  // NTS-628: the declared `properties` key is the edge-property schema —
  // every write accepting edge properties validates against it
  if (definition.properties !== undefined) {
    relationship.setEdgeProperties(edgePropertySchemas(definition.properties))
  }
}

/**
Wire any queued relationship definitions whose target now exists.
Targets defined later (e.g. `with()` order) resolve on the next call
into this module; targets that never exist simply stay unwired.
*/
function flushPendingRelationships(): void {
  for (let index = pendingRelationships.length - 1; index >= 0; index--) {
    const pending = pendingRelationships[index]

    if (pending === undefined) {
      continue
    }

    const target = modelsByName.get(pending.definition.target)

    if (!target) {
      continue
    }

    pendingRelationships.splice(index, 1)

    wireRelationshipModel(pending.constructor, pending.key, pending.definition, target)
  }

  flushPendingProjections()
}

/**
Same lazy-target resolution for queued projection definitions
*/
function flushPendingProjections(): void {
  for (let index = pendingProjections.length - 1; index >= 0; index--) {
    const pending = pendingProjections[index]

    if (pending === undefined) {
      continue
    }

    const targetName = 'target' in pending.definition ? pending.definition.target : undefined
    const target = modelFor(targetName)

    if (targetName !== undefined && targetName !== '' && target === undefined) {
      continue
    }

    pendingProjections.splice(index, 1)

    wireProjectionProperty(pending.constructor, pending.key, pending.definition, target)
  }
}

/**
Options for defineModel
*/
export interface DefineModelOptions {
  /**
  Idempotent re-registration for environments that re-evaluate the defining
  module (Nest HMR, Vitest watch mode): when `name` is already registered,
  return the existing model unchanged instead of throwing. The existing
  definition wins — schema changes need a process restart.
  */
  idempotent?: boolean
}

/**
Register a model from a map-based schema definition (neode parity),
returning the generated virtual class for the model.

The registry is process-global and a model name registers once: a second
`defineModel()` under the same name throws a descriptive error (the previous
behaviour silently orphaned the first model's schema). Pass
`{ idempotent: true }` to keep the existing registration instead — the
idempotent form returns the already-registered class for the name.
*/
export function defineModel(
  name: string,
  schema: SchemaDefinition,
  options: DefineModelOptions = {},
): Newable {
  // NTS-652: the name index is last-wins by assignment, so a second
  // registration used to silently orphan the first model's schema in the
  // process-global metamodel
  const existing = modelsByName.get(name)

  if (existing !== undefined) {
    if (options.idempotent === true) {
      return existing
    }

    throw new NeodeError(
      `A model named "${name}" is already registered — the registry is process-global, and re-registering a name silently orphans the first model's schema. Call defineModel("${name}", schema, { idempotent: true }) to return the existing model instead (module re-evaluation: Nest HMR, Vitest watch mode), or register the new definition under a different name.`,
    )
  }

  const constructor = virtualConstructor(name)

  const model = mergeModel(constructor)

  model.setLabels(schema.labels ?? [name])

  // Agent-facing model explanation (NTS-445) — never a property
  if (schema.description !== undefined) {
    model.setDescription(schema.description)
  }

  // Named filters (NTS-568) — the map-API form of @Filter: addFilter
  // asserts the name and rejects duplicates, exactly like the decorator
  const declaredFilters = schema.filters ?? []

  for (const filter of declaredFilters) {
    model.addFilter(filter)
  }

  // Every node carries an internal id (parity with neode Node._id / @InternalId)
  if (!Object.hasOwn(schema, '_id')) {
    mergeProperty(constructor, '_id', PropertyType.INTERNAL_ID)
  }

  modelsByName.set(name, constructor)
  definitionsByName.set(name, schema)

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'labels' || key === 'description' || key === 'filters' || value === undefined) {
      continue
    }

    if (isRelationshipDefinition(value)) {
      pendingRelationships.push({ constructor, key, definition: value })
    } else if (isProjectionDefinition(value)) {
      const targetName = 'target' in value ? value.target : undefined
      const target = modelFor(targetName)
      const hasTargetName = targetName !== undefined && targetName !== ''

      if (hasTargetName && target === undefined) {
        pendingProjections.push({ constructor, key, definition: value })
      } else {
        wireProjectionProperty(constructor, key, value, target)
      }
    } else if (typeof value === 'string' || isPropertyDefinition(value)) {
      definePropertyModel(constructor, key, value)
    } else {
      // Not a definition shape (e.g. a stray array): falls through to ANY,
      // exactly like definePropertyModel's own fallthrough
      definePropertyModel(constructor, key, 'any')
    }
  }

  flushPendingRelationships()

  return constructor
}

/**
Get a previously defined model constructor by name
*/
export function getModelByName(name: string): Newable | undefined {
  flushPendingRelationships()

  return modelsByName.get(name)
}

/**
Get all defined model constructors, keyed by name
*/
export function getModelsByName(): Map<string, Newable> {
  flushPendingRelationships()

  return new Map(modelsByName)
}

/**
neode's extend(): register `as` as a clone of the model `name` with `as`
added as an extra label and `schema` merged over the original definition.
*/
export function extendModel(name: string, as: string, schema: SchemaDefinition = {}): Newable {
  const original = definitionsByName.get(name)

  if (!original) {
    throw new NeodeError(unknownDefinitionError(name))
  }

  // NTS-596: remember the clone's base so observer lookups fire the base
  // model's observers for the clone's entities too
  const base = modelsByName.get(name)

  const constructor = defineModel(as, {
    ...original,
    ...schema,
    labels: [...(original.labels ?? [name]), as],
  })

  if (base !== undefined && base !== constructor) {
    extendedFrom.set(constructor, base)
  }

  return constructor
}

/**
Clone lineage (NTS-596): the model an extend() clone was cloned from, or
undefined when the model is not a clone. The chain terminates at a
non-clone model (clones are freshly defined, so it cannot cycle).
*/
export function getExtendedFrom(model: Newable): Newable | undefined {
  return extendedFrom.get(model)
}

/**
neode's helpful error message for a model lookup that found nothing
*/
export function unknownDefinitionError(name: string): string {
  const defined: string[] = []

  modelsByName.forEach((_constructor, definedName) => {
    defined.push(definedName)
  })

  let message = `Couldn't find a definition for "${name}".`

  if (defined.length === 0) {
    message += ' It looks like no models have been defined.'
  } else {
    message += ` The models currently defined are [${defined.join(', ')}]`
  }

  // NTS-446: name the fix
  message += ' — register it with defineModel() or a decorator first'

  return message
}

/**
The model registered under a projection's target name, or undefined for a
blank/absent name
*/
function modelFor(targetName: string | undefined): Newable | undefined {
  return targetName === undefined || targetName === '' ? undefined : modelsByName.get(targetName)
}
