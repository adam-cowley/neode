import type { Newable } from '../meta/newable.js'
import type { Direction } from '../query/index.js'
import type { PropertySchema } from './property-schema.js'
import { PropertyType } from './property-schema.js'

import type { RelationshipPropertySchema } from './relationship-property-schema.js'

import { EntitySchema, EntityType } from './entity/entity-schema.js'
import type { PropertyConfig } from '../decorators/property-config.interface.js'
import type { PropertyDefinition } from './schema-definition.interface.js'
import { replayRegistrations } from '../decorators/registrations.js'
import { isConstructorOf, isRecord } from '../services/type-guards.js'
const models = new Map<Newable, EntitySchema>()

// shortcut: the model registry is process-global — every Neode instance in
// the process shares one set of models, because hydration resolves schemas
// without an instance (last-constructed instance also answers entity
// instance methods). Upgrade by threading the instance through hydration
// if per-instance models are ever needed.

/**
Config keys consumed by the metamodel; anything else is a validation rule
*/
const METAMODEL_KEYS = new Set([
  'type',
  'primary',
  'unique',
  'array',
  'default',
  'onCreateSet',
  'onMatchSet',
  'alwaysSet',
  'createdAt',
  'updatedAt',
  'version',
  'fulltext',
  'required',
  'hidden',
  'protected',
  'readonly',
  'index',
  'exists',
  'fields',
  'where',
  'minHops',
  'maxHops',
  'label',
  'expression',
  'compute',
  'coalesce',
  'typed',
  'description',
  'fake',
  'vector',
  'transform',
])

export function getModels(): Map<Newable, EntitySchema> {
  return models
}

export function getModel(constructor: object): EntitySchema
export function getModel(constructor: unknown): EntitySchema | undefined
export function getModel(constructor: unknown): EntitySchema | undefined {
  // Bare classes (no class decorator) register their field decorators lazily
  if (!isConstructorOf<unknown>(constructor)) {
    return undefined
  }

  replayRegistrations(constructor)

  return getModels().get(constructor)
}

export function mergeModel(constructor: Newable): EntitySchema {
  // Field decorators queue registrations on the class's Symbol.metadata;
  // replay them before resolving so bare classes register lazily too
  replayRegistrations(constructor)

  let model = getModels().get(constructor)

  if (model === undefined) {
    model = new EntitySchema()
    getModels().set(constructor, model)
  }

  return model
}

export function mergeRelationshipModel(constructor: Newable): EntitySchema {
  // Decorators are run in a weird order (accessor, property then class decorators)
  // So this may already exist as a NodeEntity and should be confirmed
  let model = getModels().get(constructor)

  if (model === undefined) {
    model = new EntitySchema()
    getModels().set(constructor, model)
  }

  model.setType(EntityType.RelationshipEntity)

  return model
}

// PropertyConfig | PropertyDefinition: decorator configs vs the map adapter's
// (structurally compatible; PropertyDefinition just lacks the rule index signature)
export function mergeProperty(
  constructor: Newable,
  key: string,
  type: PropertyType,
  config: PropertyConfig | PropertyDefinition = {},
): PropertySchema {
  const model = mergeModel(constructor)

  if (!model.hasProperty(key)) {
    model.addProperty(key)
  }

  const property = model.getProperty(key)

  // If specificially set, then overwrite the type
  if (type !== PropertyType.ANY) {
    property.setType(type)
  }

  // Set Config
  if (config.primary === true) {
    property.setPrimaryKey(true)
  }

  if (config.unique === true) {
    property.setUnique(true)
  }

  if (Array.isArray(config.unique)) {
    property.setCompositeUnique(config.unique)
  }

  if (config.array === true) {
    property.setArray(true)
  }

  if (config.required === true) {
    property.setRequired(true)
  }

  if (config.hidden === true) {
    property.setHidden(true)
  }

  if (config.protected === true) {
    property.setProtected(true)
  }

  if (config.readonly === true) {
    property.setReadonly(true)
  }

  if (config.index === true) {
    property.setIndex(true)
  }

  if (Array.isArray(config.index)) {
    property.setCompositeIndex(config.index)
  }

  if (config.typed === true) {
    property.setTyped(true)
  }

  if (config.exists === true) {
    property.setExists(true)
  }

  if (config.default !== undefined) {
    property.setDefaultValue(config.default)
  }

  if (Object.hasOwn(config, 'onCreateSet')) {
    property.setOnCreateSet(config.onCreateSet)
  }

  if (Object.hasOwn(config, 'onMatchSet')) {
    property.setOnMatchSet(config.onMatchSet)
  }

  if (Object.hasOwn(config, 'alwaysSet')) {
    property.setAlwaysSet(config.alwaysSet)
  }

  // Server-side timestamps (NTS-165)
  if (Object.hasOwn(config, 'createdAt')) {
    property.setCreatedAt(config.createdAt)
  }

  if (Object.hasOwn(config, 'updatedAt')) {
    property.setUpdatedAt(config.updatedAt)
  }

  // Optimistic locking (NTS-158)
  if (Object.hasOwn(config, 'version')) {
    property.setVersion(config.version)
  }

  if (config.fulltext === true) {
    property.setFulltext(true)
  }

  // Agent-facing property explanation (NTS-445)
  if (typeof config.description === 'string') {
    property.setDescription(config.description)
  }

  // Read-model projection config (NTS-135/136/137/138)
  const projection: Record<string, unknown> = isRecord(config) ? config : {}

  if (isStringArray(projection['fields'])) {
    property.setFields(projection['fields'])
  }

  if (typeof projection['where'] === 'string') {
    property.setWhere(projection['where'])
  }

  if (typeof projection['minHops'] === 'number') {
    property.setMinHops(projection['minHops'])
  }

  if (typeof projection['maxHops'] === 'number') {
    property.setMaxHops(projection['maxHops'])
  }

  if (typeof projection['label'] === 'string') {
    property.setLabel(projection['label'])
  }

  if (typeof projection['expression'] === 'string') {
    property.setExpression(projection['expression'])
  }

  if (isFunction(projection['compute'])) {
    property.setCompute(projection['compute'])
  }

  // Hydration defaults (NTS-139): literal or sibling-property coalesce
  if (isCoalesce(projection['coalesce'])) {
    property.setCoalesce(projection['coalesce'])
  }

  // Factory seeding (NTS-444): per-property fake data generator
  if (isFunction(projection['fake'])) {
    property.setFake(projection['fake'])
  }

  // Vector index declaration (NTS-447)
  if (config.vector !== undefined) {
    property.setVector(config.vector)
  }

  // Property value transforms (NTS-449)
  if (config.transform !== undefined) {
    property.setTransform(config.transform)
  }

  // Persist every config key the metamodel has no flag for as a validation rule
  property.setRules(
    Object.fromEntries(Object.entries(config).filter(([key]) => !METAMODEL_KEYS.has(key))),
  )

  return property
}

export function mergeRelationshipProperty(
  constructor: Newable,
  key: string,
  type: string,
  target: Newable | (() => Newable),
  direction: Direction,
  isMany: boolean,
  isEager?: boolean,
  description?: string,
  isCascade = false,
): RelationshipPropertySchema {
  const model = mergeModel(constructor)

  if (!model.hasProperty(key)) {
    model.addRelationship(key)
  }

  const relationship = model.getRelationship(key)

  relationship.setType(type)
  relationship.setDirection(direction)
  relationship.setTarget(target)
  relationship.setMany(isMany)
  relationship.setEager(isEager ?? false)
  relationship.setCascade(isCascade)

  // Agent-facing relationship explanation (NTS-445)
  if (description !== undefined) {
    relationship.setDescription(description)
  }

  return relationship
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isFunction(value: unknown): value is (argument?: unknown) => unknown {
  return typeof value === 'function'
}

function isCoalesce(value: unknown): value is string | string[] {
  return typeof value === 'string' || Array.isArray(value)
}
