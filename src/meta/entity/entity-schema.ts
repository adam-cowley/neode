import { NeodeError } from '../../errors/index.js'
import type { Newable } from '../newable.js'
import { PropertySchema } from '../property-schema.js'
import { RelationshipPropertySchema } from '../relationship-property-schema.js'

export const EntityType = {
  NodeEntity: 0,
  RelationshipEntity: 1,
} as const

export type EntityType = (typeof EntityType)[keyof typeof EntityType]

export class EntitySchema {
  private labels: string[] = []
  private objectConstructor!: Newable

  /**
  Undeclared default primary keys (<first label lowercased>_id), cached per
  key so getPrimaryKey() is reference-stable without registering the
  property on the schema
  */
  private readonly phantomPrimaryKeys = new Map<string, PropertySchema>()

  /**
  Free-text explanation emitted by the agent ontology (NTS-445)
  */
  private description: string | undefined

  protected properties = new Map<string, PropertySchema>()
  protected relationships = new Map<string, RelationshipPropertySchema>()
  protected entityType: EntityType = EntityType.NodeEntity

  constructor(entityType: EntityType = EntityType.NodeEntity) {
    this.entityType = entityType
  }

  /**
  The model's display name for error messages (NTS-446): its labels, or a
  fallback while labels are unset
  */
  private modelName(): string {
    return this.labels.join(':') || 'entity'
  }

  setLabels(labels: string[]): void {
    const sorted = [...new Set(labels)]

    sorted.sort(compareStrings)

    this.labels = sorted
  }

  getLabels(): string[] {
    return [...this.labels]
  }

  addLabel(label: string): void {
    this.setLabels([...this.labels, label])
  }

  setDescription(description: string): void {
    this.description = description
  }

  getDescription(): string | undefined {
    return this.description
  }

  addRelationship(key: string): void {
    this.relationships.set(key, new RelationshipPropertySchema(key))
  }

  hasRelationship(key: string): boolean {
    return this.relationships.has(key)
  }

  getRelationship(key: string): RelationshipPropertySchema {
    const relationship = this.relationships.get(key)

    if (relationship === undefined) {
      // NTS-446: name the model, the known relationships, and the fix
      const defined = this.getRelationships().map((entry) => entry.getKey())

      throw new NeodeError(
        `Relationship "${key}" is not defined on model "${this.modelName()}"` +
          (defined.length > 0
            ? ` — defined relationships: ${defined.join(', ')}. ` +
              'Check the relationship key, or declare it on the model.'
            : ' — the model declares no relationships; declare one first.'),
      )
    }

    return relationship
  }

  getRelationships(): RelationshipPropertySchema[] {
    const relationships: RelationshipPropertySchema[] = []

    for (const relationship of this.relationships.values()) {
      relationships.push(relationship)
    }

    return relationships
  }

  setConstructor(constructor: Newable): void {
    this.objectConstructor = constructor
  }

  getConstructor(): Newable {
    return this.objectConstructor
  }

  setType(type: EntityType): void {
    this.entityType = type
  }

  getType(): EntityType {
    return this.entityType
  }

  hasProperty(key: string): boolean {
    return this.properties.has(key)
  }

  getPrimaryKey(): PropertySchema | undefined {
    // Explicit primary key always wins
    const explicit = this.getProperties().find((property) => property.isPrimaryKey())

    if (explicit) {
      return explicit
    }

    // Default primary key to <first label lowercased>_id (see neode Model.js)
    const [firstLabel] = this.getLabels()

    if (firstLabel === undefined || firstLabel === '') {
      return undefined
    }

    const key = `${firstLabel.toLowerCase()}_id`

    if (this.hasProperty(key)) {
      const property = this.getProperty(key)

      property.setPrimaryKey()

      return property
    }

    // Undeclared default: a phantom property, deliberately NOT added to the
    // schema — a getter must not mutate, and a registered-but-never-written
    // property would install a dead unique constraint and hydrate as a
    // field. Cached per key so repeated calls return the same instance.
    let phantom = this.phantomPrimaryKeys.get(key)

    if (!phantom) {
      phantom = new PropertySchema(key)
      phantom.setPrimaryKey()
      this.phantomPrimaryKeys.set(key, phantom)
    }

    return phantom
  }

  getProperty(key: string): PropertySchema {
    const property = this.properties.get(key)

    if (property === undefined) {
      // NTS-446: name the model, the known properties, and the fix
      const defined = this.getProperties().map((entry) => entry.getKey())

      throw new NeodeError(
        `Property "${key}" is not defined on model "${this.modelName()}"` +
          (defined.length > 0
            ? ` — defined properties: ${defined.join(', ')}. ` +
              'Check the property key, or declare it on the model.'
            : ' — the model declares no properties; declare one first.'),
      )
    }

    return property
  }

  addProperty(key: string): Map<string, PropertySchema> {
    return this.properties.set(key, new PropertySchema(key))
  }

  getProperties(): PropertySchema[] {
    const properties: PropertySchema[] = []

    for (const property of this.properties.values()) {
      properties.push(property)
    }

    return properties
  }
}

/**
Default Array#sort order for label strings (UTF-16 code-unit comparison, the
same order the previous no-comparator sort produced)
*/
function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1
  }

  return a > b ? 1 : 0
}
