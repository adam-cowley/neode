import type { ConnectionProvider } from '../../driver/types.js'
import { quote } from '../../query/quote.js'
import {
  ConstraintAction,
  ConstraintType,
  schemaObjectName,
  type SchemaResult,
} from './schema-objects.js'

const SIMILARITY_FUNCTIONS = ['cosine', 'euclidean'] as const

/**
A vector index to keep installed on the database
*/
export interface VectorIndexDefinition {
  label: string
  property: string
  /**
  Number of dimensions of the stored vectors — must match the embedding model
  */
  dimensions: number
  similarityFunction?: (typeof SIMILARITY_FUNCTIONS)[number]
  /**
  Defaults to `<label>_<property>_vector`
  */
  name?: string
}

export function vectorIndexName(definition: VectorIndexDefinition): string {
  return (
    definition.name ??
    schemaObjectName(definition.label, [definition.property], ConstraintType.VECTOR)
  )
}

export function createVectorStatement(definition: VectorIndexDefinition): string {
  const dimensions = definition.dimensions

  if (!Number.isSafeInteger(dimensions) || dimensions <= 0) {
    throw new TypeError(
      `Cannot create a vector index on label "${definition.label}", property "${definition.property}": ` +
        `dimensions must be a positive integer, received ${String(dimensions)} — ` +
        'set `dimensions` on the @Property vector config to match the embedding model',
    )
  }

  const similarity = definition.similarityFunction ?? 'cosine'

  if (!SIMILARITY_FUNCTIONS.includes(similarity)) {
    throw new TypeError(
      `Cannot create a vector index on label "${definition.label}", property "${definition.property}": ` +
        `unknown similarity function "${similarity}" (expected ${SIMILARITY_FUNCTIONS.join(' or ')})`,
    )
  }

  return (
    `CREATE VECTOR INDEX ${vectorIndexName(definition)} IF NOT EXISTS ` +
    `FOR (n:${quote(definition.label)}) ON (n.${quote(definition.property)}) ` +
    `OPTIONS { indexConfig: { \`vector.dimensions\`: ${String(dimensions)}, \`vector.similarity_function\`: '${similarity}' } }`
  )
}

export function dropVectorStatement(name: string): string {
  return `DROP VECTOR INDEX ${name} IF EXISTS`
}

/**
Installs/drops the given vector index definitions, following the same
result-reporting pattern as SchemaService
*/
export class VectorIndexService {
  private readonly connection: ConnectionProvider
  private readonly definitions: VectorIndexDefinition[]

  constructor(connection: ConnectionProvider, definitions: VectorIndexDefinition[]) {
    this.connection = connection
    this.definitions = definitions
  }

  private async runOne(
    action: ConstraintAction,
    definition: VectorIndexDefinition,
  ): Promise<SchemaResult> {
    const statement =
      action === ConstraintAction.CREATE
        ? createVectorStatement(definition)
        : dropVectorStatement(vectorIndexName(definition))

    const output: SchemaResult = {
      action,
      type: ConstraintType.VECTOR,
      label: definition.label,
      property: definition.property,
      properties: [definition.property],
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
