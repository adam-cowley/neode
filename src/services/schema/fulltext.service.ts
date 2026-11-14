import type { ConnectionProvider } from '../../driver/types.js'
import { NeodeError } from '../../errors/neode-error.js'
import { quote } from '../../query/quote.js'
import {
  ConstraintAction,
  ConstraintType,
  schemaObjectName,
  type SchemaResult,
} from './schema-objects.js'

/**
A full-text index to keep installed on the database
*/
export interface FulltextIndexDefinition {
  label: string
  properties: string[]
  /**
  Defaults to `<label>_<props joined by _>_fulltext`
  */
  name?: string
}

export function fulltextIndexName(definition: FulltextIndexDefinition): string {
  return (
    definition.name ??
    schemaObjectName(definition.label, definition.properties, ConstraintType.FULLTEXT)
  )
}

export function createFulltextStatement(
  definition: FulltextIndexDefinition,
  shouldQuoteLabel = true,
): string {
  if (definition.properties.length === 0) {
    throw new TypeError(
      `Cannot create a full-text index on ${definition.label}: no properties given`,
    )
  }

  const properties = definition.properties.map((property) => `n.${quote(property)}`).join(', ')

  const labelPattern = shouldQuoteLabel ? `n:${quote(definition.label)}` : `n:${definition.label}`

  return `CREATE FULLTEXT INDEX ${fulltextIndexName(definition)} IF NOT EXISTS FOR (${labelPattern}) ON EACH [${properties}]`
}

export function dropFulltextStatement(name: string): string {
  return `DROP FULLTEXT INDEX ${name} IF EXISTS`
}

/**
Installs/drops the given full-text index definitions, following the same
result-reporting pattern as SchemaService
*/
export class FulltextIndexService {
  private readonly connection: ConnectionProvider
  private readonly definitions: FulltextIndexDefinition[]

  constructor(connection: ConnectionProvider, definitions: FulltextIndexDefinition[]) {
    this.connection = connection
    this.definitions = definitions
  }

  private async runOne(
    action: ConstraintAction,
    definition: FulltextIndexDefinition,
  ): Promise<SchemaResult> {
    const statement =
      action === ConstraintAction.CREATE
        ? createFulltextStatement(definition)
        : dropFulltextStatement(fulltextIndexName(definition))

    const property = definition.properties[0]

    if (property === undefined) {
      throw new NeodeError(`Fulltext definition for ${definition.label} has no properties`)
    }

    const output: SchemaResult = {
      action,
      type: ConstraintType.FULLTEXT,
      label: definition.label,
      property,
      properties: definition.properties,
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

  private async run(action: ConstraintAction): Promise<SchemaResult[]> {
    // Sequential: Neo4j can abort concurrent schema writes
    const results: SchemaResult[] = []

    for (const definition of this.definitions) {
      results.push(await this.runOne(action, definition))
    }

    return results
  }

  async create(): Promise<SchemaResult[]> {
    return this.run(ConstraintAction.CREATE)
  }

  async drop(): Promise<SchemaResult[]> {
    return this.run(ConstraintAction.DROP)
  }
}
