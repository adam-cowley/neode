import type { ConnectionProvider } from '../../driver/types.js'
import { getModels } from '../../meta/index.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import type { PropertySchema } from '../../meta/property-schema.js'
import {
  ConstraintAction,
  ConstraintType,
  cypherPropertyType,
  isEnterpriseConnection,
  propertyTypeStatement,
  schemaObjectName,
  schemaStatement,
  type SchemaResult,
} from './schema-objects.js'
import { FulltextIndexService } from './fulltext.service.js'
import { NeodeError } from '../../errors/neode-error.js'
import { VectorIndexService, type VectorIndexDefinition } from './vector.service.js'

// Re-exported for the callers that import these from the schema service
export * from './schema-objects.js'

/**
Vector index definitions for the vector-declared properties of one label
(NTS-447): one `VectorIndexDefinition` per property carrying a `vector`
config, named by the deterministic `vectorIndexName()`.
*/
export function vectorIndexDefinitionsForLabel(
  label: string,
  properties: PropertySchema[],
): VectorIndexDefinition[] {
  const definitions: VectorIndexDefinition[] = []

  for (const property of properties) {
    const vector = property.getVector()

    if (vector !== undefined) {
      definitions.push({ label, property: property.getKey(), ...vector })
    }
  }

  return definitions
}

export class SchemaService {
  private readonly connection: ConnectionProvider

  constructor(connection: ConnectionProvider) {
    this.connection = connection
  }

  private async runSchemaStatements(action: ConstraintAction): Promise<SchemaResult[]> {
    // NTS-598 — EXISTS / property-type constraints are declared from the
    // DETECTED edition (cached per connection), not a manual flag
    const isEnterprise = await isEnterpriseConnection(this.connection)

    // Sequential on purpose: Neo4j can abort concurrent schema writes
    // (schema-lock contention), so DDL statements never run in parallel
    const results: SchemaResult[] = []

    for (const model of getModels().values()) {
      results.push(...(await this.runSchemaStatementsForModel(action, model, isEnterprise)))
    }

    return results
  }

  private async runSchemaStatementsForModel(
    action: ConstraintAction,
    model: EntitySchema,
    isEnterprise: boolean,
  ): Promise<SchemaResult[]> {
    // Sequential: see runSchemaStatements
    const output: SchemaResult[] = []

    for (const label of model.getLabels()) {
      output.push(...(await this.runSchemaStatementsForLabel(action, model, label, isEnterprise)))
    }

    return output
  }

  private async runSchemaStatementsForLabel(
    action: ConstraintAction,
    model: EntitySchema,
    label: string,
    isEnterprise: boolean,
  ): Promise<SchemaResult[]> {
    const properties = model.getProperties()

    const uniques = await this.runUniqueConstraintStatementsForLabel(action, properties, label)

    const indexes = await this.runIndexStatementsForLabel(action, properties, label)

    // Composite unique/index constraints (NTS-140), deduped by name:
    // the composite may be declared on more than one of its properties
    const compositeUniques = await this.runCompositeStatementsForLabel(
      action,
      properties,
      label,
      ConstraintType.UNIQUE,
      (property) => property.getCompositeUnique(),
    )

    const compositeIndexes = await this.runCompositeStatementsForLabel(
      action,
      properties,
      label,
      ConstraintType.INDEX,
      (property) => property.getCompositeIndex(),
    )

    // Property-type constraints (NTS-141): opt-in via `typed: true`,
    // generated only for declared types with a Cypher equivalent.
    // Enterprise-only on the server side — skipped on Community editions,
    // where every attempt would fail the whole install
    const propertyTypes = isEnterprise
      ? await this.runPropertyTypeStatementsForLabel(action, properties, label)
      : []

    // Full-text indexes (NTS-436): one index per label covering every
    // property declared `fulltext: true`, installed/dropped alongside the
    // constraints so callers never handle index names
    const fulltext = await this.runFulltextStatementsForLabel(action, properties, label)

    // Vector indexes (NTS-447): one per property declared with a vector
    // config, run through VectorIndexService (statement logic is not
    // duplicated here)
    const vectors = await this.runVectorStatementsForLabel(action, properties, label)

    if (isEnterprise) {
      const exists = await this.runExistsConstraintStatementsForLabel(action, properties, label)

      return [
        ...uniques,
        ...indexes,
        ...compositeUniques,
        ...compositeIndexes,
        ...propertyTypes,
        ...fulltext,
        ...vectors,
        ...exists,
      ]
    }

    return [
      ...uniques,
      ...indexes,
      ...compositeUniques,
      ...compositeIndexes,
      ...propertyTypes,
      ...fulltext,
      ...vectors,
    ]
  }

  private async runVectorStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
  ): Promise<SchemaResult[]> {
    const definitions = vectorIndexDefinitionsForLabel(label, properties)

    if (definitions.length === 0) {
      return []
    }

    const service = new VectorIndexService(this.connection, definitions)

    return action === ConstraintAction.CREATE ? service.create() : service.drop()
  }

  private async runFulltextStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
  ): Promise<SchemaResult[]> {
    const fulltext = properties.filter((property) => property.getFulltext())

    if (fulltext.length === 0) {
      return []
    }

    const service = new FulltextIndexService(this.connection, [
      { label, properties: fulltext.map((property) => property.getKey()) },
    ])

    return action === ConstraintAction.CREATE ? service.create() : service.drop()
  }

  private async runUniqueConstraintStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
  ): Promise<SchemaResult[]> {
    // Sequential: see runSchemaStatements
    const results: SchemaResult[] = []

    const uniques = properties.filter((property) => property.isUnique())

    for (const property of uniques) {
      results.push(
        await this.runStatement(action, ConstraintType.UNIQUE, label, [property.getKey()]),
      )
    }

    return results
  }

  private async runExistsConstraintStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
  ): Promise<SchemaResult[]> {
    // Sequential: see runSchemaStatements
    const results: SchemaResult[] = []

    const exists = properties.filter((property) => property.isExists())

    for (const property of exists) {
      results.push(
        await this.runStatement(action, ConstraintType.EXISTS, label, [property.getKey()]),
      )
    }

    return results
  }

  private async runIndexStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
  ): Promise<SchemaResult[]> {
    // Sequential: see runSchemaStatements
    const results: SchemaResult[] = []

    const indexes = properties.filter((property) => property.isIndex())

    for (const property of indexes) {
      results.push(
        await this.runStatement(action, ConstraintType.INDEX, label, [property.getKey()]),
      )
    }

    return results
  }

  private async runCompositeStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
    type: (typeof ConstraintType)['UNIQUE'] | (typeof ConstraintType)['INDEX'],
    select: (property: PropertySchema) => string[] | undefined,
  ): Promise<SchemaResult[]> {
    const composites = new Map<string, string[]>()

    for (const property of properties) {
      const list = select(property)

      if (list === undefined || list.length === 0) {
        continue
      }

      composites.set(schemaObjectName(label, list, type), list)
    }

    // Sequential: see runSchemaStatements
    const results: SchemaResult[] = []

    for (const [name, list] of composites) {
      results.push(await this.runStatement(action, type, label, list, name))
    }

    return results
  }

  private async runPropertyTypeStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
  ): Promise<SchemaResult[]> {
    // Sequential: see runSchemaStatements
    const results: SchemaResult[] = []

    const typed = properties.filter((property) => property.isTyped())

    for (const property of typed) {
      const type = cypherPropertyType(property.getType())

      if (type === undefined) {
        results.push({
          action,
          type: ConstraintType.PROPERTY_TYPE,
          label,
          property: property.getKey(),
          statement: '',
          success: false,
          error: new Error(
            `No property-type constraint can be generated for "${property.getKey()}": ` +
              'its declared type has no single Cypher property type',
          ),
        })

        continue
      }

      results.push(
        await this.runStatement(
          action,
          ConstraintType.PROPERTY_TYPE,
          label,
          [property.getKey()],
          undefined,
          type,
        ),
      )
    }

    return results
  }

  private async runStatement(
    action: ConstraintAction,
    type: ConstraintType,
    label: string,
    properties: string[],
    name?: string,
    cypherType?: string,
  ): Promise<SchemaResult> {
    const property = properties[0]

    if (property === undefined) {
      throw new NeodeError('A schema constraint requires at least one property')
    }

    let statement: string

    if (type === ConstraintType.PROPERTY_TYPE) {
      if (cypherType === undefined) {
        throw new NeodeError('A property-type constraint requires a Cypher type')
      }

      statement = propertyTypeStatement(action, label, property, cypherType, name)
    } else {
      statement = schemaStatement(action, type, label, properties, name)
    }

    const output: SchemaResult = {
      action,
      type,
      label,
      property,
      ...(properties.length > 1 && { properties }),
      statement,
      success: false,
    }

    try {
      await this.connection.run(statement, {}, 'WRITE')

      output.success = true
    } catch (error) {
      output.error = error instanceof Error ? error : new Error(String(error))
    }

    return output
  }

  async create(): Promise<SchemaResult[]> {
    return this.runSchemaStatements(ConstraintAction.CREATE)
  }

  async drop(): Promise<SchemaResult[]> {
    return this.runSchemaStatements(ConstraintAction.DROP)
  }
}
