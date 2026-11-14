import type { ConnectionProvider } from '../../driver/types.js'
import { getModels } from '../../meta/index.js'
import {
  ConstraintType,
  cypherPropertyType,
  isEnterpriseConnection,
  schemaObjectName,
} from './schema.service.js'
import { type FulltextIndexDefinition, fulltextIndexName } from './fulltext.service.js'
import { type VectorIndexDefinition, vectorIndexName } from './vector.service.js'
import type { GraphTypeConstraintDefinition } from './graph-type.service.js'

/**
Push a schema object into the declared list unless its name is already declared
*/
function declared(list: SchemaObject[], object: SchemaObject): void {
  if (list.every((existing) => existing.name !== object.name)) {
    list.push(object)
  }
}

/**
Which objects count as "declared" for the inspection: pass the
full-text/vector index definitions your installSchema call used, so the
diff is not polluted by false "extra" entries. The edition is DETECTED
from the connection (NTS-598) — EXISTS / property-type constraints are
declared only on Enterprise.
*/
export interface InspectOptions {
  /**
  Full-text index definitions to include in the declared set
  */
  fulltext?: FulltextIndexDefinition[]
  /**
  Vector index definitions to include in the declared set
  */
  vector?: VectorIndexDefinition[]
  /**
  NTS-550 — named graph type constraint items (the extras passed to
  installGraphType()) so the graph type family does not report them missing
  */
  graphTypeConstraints?: GraphTypeConstraintDefinition[]
}

/**
One constraint or index as inspected from the database (SHOW
CONSTRAINTS / SHOW INDEXES).
*/
export interface SchemaObject {
  name: string
  type: string
  labelsOrTypes: string[]
  properties: string[]
}

/**
The declared-vs-installed diff for one schema family (constraints or
indexes): the raw object lists plus the names that only appear on one
side.
*/
export interface SchemaDiff {
  /**
  Objects found on the database
  */
  installed: SchemaObject[]
  /**
  Objects the registered schemas would install
  */
  declared: SchemaObject[]
  /**
  Declared but not installed
  */
  missing: string[]
  /**
  Installed but not declared
  */
  extra: string[]
}

/**
The full inspectSchema result: constraint and index diffs against the
declared models.
*/
export interface SchemaInspection {
  constraints: SchemaDiff
  indexes: SchemaDiff
}

/**
One row of a SHOW CONSTRAINTS / SHOW INDEXES result
*/
interface ShowRow {
  has(key: string): boolean
  get(key: string): unknown
}

/**
String column value, defaulting to '' (the driver omits absent columns)
*/
function rowString(row: ShowRow, key: string): string {
  const value = row.has(key) ? row.get(key) : undefined

  return typeof value === 'string' ? value : ''
}

/**
String[] column value, defaulting to []
*/
function rowStringList(row: ShowRow, key: string): string[] {
  const value = row.has(key) ? row.get(key) : undefined

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function rowToObject(row: ShowRow): SchemaObject {
  return {
    name: rowString(row, 'name'),
    type: rowString(row, 'type'),
    labelsOrTypes: row.has('labelsOrTypes') ? rowStringList(row, 'labelsOrTypes') : [],
    properties: row.has('properties') ? rowStringList(row, 'properties') : [],
  }
}

/**
Constraint-backed indexes are reported by both SHOW commands — keep them
out of the index diff, as are the system-managed token lookup indexes
*/
function indexRowToObject(row: ShowRow): SchemaObject | null {
  const object = rowToObject(row)

  if (object.type === 'LOOKUP') {
    return null
  }

  const owningConstraint = row.has('owningConstraint') ? row.get('owningConstraint') : undefined

  return owningConstraint === null || owningConstraint === undefined ? object : null
}

/**
The schema objects the registered models (plus the given definitions) would
install. `enterprise` is the RESOLVED edition gate (NTS-598): inspectSchema
passes the edition detected from the connection — EXISTS and property-type
constraints are Enterprise-only, both at install time and here.
*/
export function declaredSchemaObjects(
  options: {
    fulltext?: FulltextIndexDefinition[]
    vector?: VectorIndexDefinition[]
    graphTypeConstraints?: GraphTypeConstraintDefinition[]
    enterprise?: boolean
  } = {},
): {
  constraints: SchemaObject[]
  indexes: SchemaObject[]
} {
  const isEnterprise = options.enterprise === true
  const constraints: SchemaObject[] = []
  const indexes: SchemaObject[] = []

  for (const model of getModels().values()) {
    for (const label of model.getLabels()) {
      for (const property of model.getProperties()) {
        const key = property.getKey()

        if (property.isUnique()) {
          constraints.push({
            name: schemaObjectName(label, [key], ConstraintType.UNIQUE),
            type: ConstraintType.UNIQUE,
            labelsOrTypes: [label],
            properties: [key],
          })
        }

        if (isEnterprise && property.isExists()) {
          constraints.push({
            name: schemaObjectName(label, [key], ConstraintType.EXISTS),
            type: ConstraintType.EXISTS,
            labelsOrTypes: [label],
            properties: [key],
          })
        }

        if (property.isIndex()) {
          indexes.push({
            name: schemaObjectName(label, [key], ConstraintType.INDEX),
            type: ConstraintType.INDEX,
            labelsOrTypes: [label],
            properties: [key],
          })
        }

        // Property-type constraint (NTS-141), opt-in via `typed: true` —
        // Enterprise-only, matching the install gate
        if (
          isEnterprise &&
          property.isTyped() &&
          cypherPropertyType(property.getType()) !== undefined
        ) {
          constraints.push({
            name: schemaObjectName(label, [key], ConstraintType.PROPERTY_TYPE),
            type: ConstraintType.PROPERTY_TYPE,
            labelsOrTypes: [label],
            properties: [key],
          })
        }

        // Composite unique / index (NTS-140): the full composite is
        // declared on one property — dedup by name when more than
        // one of its properties declares it
        const compositeUnique = property.getCompositeUnique()

        if (compositeUnique !== undefined && compositeUnique.length > 0) {
          declared(constraints, {
            name: schemaObjectName(label, compositeUnique, ConstraintType.UNIQUE),
            type: ConstraintType.UNIQUE,
            labelsOrTypes: [label],
            properties: compositeUnique,
          })
        }

        const compositeIndex = property.getCompositeIndex()

        if (compositeIndex !== undefined && compositeIndex.length > 0) {
          declared(indexes, {
            name: schemaObjectName(label, compositeIndex, ConstraintType.INDEX),
            type: ConstraintType.INDEX,
            labelsOrTypes: [label],
            properties: compositeIndex,
          })
        }
      }
    }
  }

  const fulltextDefinitions = options.fulltext ?? []

  for (const definition of fulltextDefinitions) {
    indexes.push({
      name: fulltextIndexName(definition),
      type: ConstraintType.FULLTEXT,
      labelsOrTypes: [definition.label],
      properties: definition.properties,
    })
  }

  const vectorDefinitions = options.vector ?? []

  for (const definition of vectorDefinitions) {
    indexes.push({
      name: vectorIndexName(definition),
      type: ConstraintType.VECTOR,
      labelsOrTypes: [definition.label],
      properties: [definition.property],
    })
  }

  return { constraints, indexes }
}

/**
Read the installed schema (SHOW CONSTRAINTS / SHOW INDEXES) and diff it against the declared schema
*/
export async function inspectSchema(
  connection: ConnectionProvider,
  options: InspectOptions = {},
): Promise<SchemaInspection> {
  // NTS-598 — the declared set follows the DETECTED edition, so Community
  // databases are never told their missing EXISTS / property-type
  // constraints are drift
  const [isEnterprise, constraintRows, indexRows] = await Promise.all([
    isEnterpriseConnection(connection),
    connection.run('SHOW CONSTRAINTS', {}, 'READ'),
    connection.run('SHOW INDEXES', {}, 'READ'),
  ])

  const installedConstraints = constraintRows.records.map((row) => rowToObject(row))

  const installedIndexes = indexRows.records
    .map((row) => indexRowToObject(row))
    .filter((object): object is SchemaObject => object !== null)

  const declaredObjects = declaredSchemaObjects({ ...options, enterprise: isEnterprise })

  return {
    constraints: diff(declaredObjects.constraints, installedConstraints),
    indexes: diff(declaredObjects.indexes, installedIndexes),
  }
}

function diff(declared: SchemaObject[], installed: SchemaObject[]): SchemaDiff {
  const declaredNames = new Set(declared.map((object) => object.name))
  const installedNames = new Set(installed.map((object) => object.name))

  return {
    installed,
    declared,
    missing: declared
      .filter((object) => !installedNames.has(object.name))
      .map((object) => object.name),
    extra: installed
      .filter((object) => !declaredNames.has(object.name))
      .map((object) => object.name),
  }
}
