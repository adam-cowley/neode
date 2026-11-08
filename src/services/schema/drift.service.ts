import { getModels } from '../../meta/index.js'
import type { ConnectionProvider } from '../../driver/types.js'
import {
  ConstraintAction,
  ConstraintType,
  type SchemaResult,
  cypherPropertyType,
  propertyTypeStatement,
  schemaObjectName,
  schemaStatement,
  vectorIndexDefinitionsForLabel,
} from './schema.service.js'
import {
  type FulltextIndexDefinition,
  createFulltextStatement,
  dropFulltextStatement,
} from './fulltext.service.js'
import {
  type VectorIndexDefinition,
  createVectorStatement,
  dropVectorStatement,
  vectorIndexName,
} from './vector.service.js'
import {
  type GraphTypeConstraintDefinition,
  type GraphTypeDefinition,
  type GraphTypeNodeDefinition,
  type GraphTypePropertyDefinition,
  type GraphTypeRelationshipDefinition,
  currentGraphType,
  deriveGraphType,
  graphTypeAddStatement,
  graphTypeAlterStatement,
  graphTypeConstraintName,
  graphTypeDropStatement,
  graphTypeSetStatement,
  parseGraphTypeSpecification,
} from './graph-type.service.js'
import {
  type InspectOptions,
  type SchemaDiff,
  type SchemaObject,
  inspectSchema,
} from './inspect.service.js'

/**
One drifted schema object: what it is, where it lives, and the exact
statement(s) that would resolve the drift (NTS-450)
*/ export interface SchemaDriftEntry {
  name: string
  type: string
  labelsOrTypes: string[]
  properties: string[]
  /**
  The CREATE statement that would install the object — present on
  missing and mismatched entries
  */
  createStatement?: string | undefined
  /**
  The DROP statement that would remove the object — present on stale
  and mismatched entries
  */
  dropStatement?: string | undefined
}

/**
Drift of one schema family (constraints or indexes), grouped by action
*/
export interface SchemaDriftGroup {
  /**
  Declared but not installed — applied by `applySchemaDiff`
  */
  missing: SchemaDriftEntry[]
  /**
  Installed but not declared — only dropped with `dropStale: true`
  */
  stale: SchemaDriftEntry[]
  /**
  Installed under a declared name with a different definition — never
  applied automatically: resolving one means dropping and re-creating
  */
  mismatched: SchemaDriftEntry[]
}

export interface SchemaDrift {
  constraints: SchemaDriftGroup
  indexes: SchemaDriftGroup
  /**
  NTS-550 — the graph type family, present only when the backend supports
  graph types (`SHOW CURRENT GRAPH TYPE`). Report-only: the fix statements
  are `ADD`/`DROP`/`ALTER` per element, and the declared statement is the
  full `SET` replace.
  */
  graphType?: GraphTypeDrift
}

/**
NTS-550 — drift of the graph type: the installed canonical specification
versus the model-derived definition, per element
*/
export interface GraphTypeDrift {
  /**
  The installed canonical specification string (undefined: none installed)
  */
  installed: string | undefined
  /**
  The declared `ALTER CURRENT GRAPH TYPE SET { ... }` — the full-replace
  fix statement
  */
  declaredStatement: string
  missing: SchemaDriftEntry[]
  stale: SchemaDriftEntry[]
  mismatched: SchemaDriftEntry[]
}

/**
Options for applySchemaDrift.
*/
export interface ApplySchemaDiffOptions {
  /**
  Also drop stale objects (installed but not declared). Off by default:
  dropping is destructive
  */
  dropStale?: boolean
}

/**
Full-text indexes declared on model properties (the `fulltext: true`
flag), one per label — the same objects SchemaService installs
*/
function declaredFulltextDefinitions(): FulltextIndexDefinition[] {
  const definitions: FulltextIndexDefinition[] = []

  for (const model of getModels().values()) {
    for (const label of model.getLabels()) {
      definitions.push({
        label,
        properties: model
          .getProperties()
          .filter((property) => property.getFulltext())
          .map((property) => property.getKey()),
      })
    }
  }

  return definitions.filter((definition) => definition.properties.length > 0)
}

/**
Vector index declarations from model metadata (NTS-447), so the drift
report covers model-declared vector indexes without the caller passing
them via options — mirroring declaredFulltextDefinitions()
*/
function declaredVectorDefinitions(): VectorIndexDefinition[] {
  const definitions: VectorIndexDefinition[] = []

  for (const model of getModels().values()) {
    for (const label of model.getLabels()) {
      definitions.push(...vectorIndexDefinitionsForLabel(label, model.getProperties()))
    }
  }

  return definitions
}

/**
Cypher property type per declared property-type constraint name: the
statement builder needs it and the inspected SchemaObject does not
carry it
*/
function declaredPropertyTypes(): Map<string, string> {
  const types = new Map<string, string>()

  for (const model of getModels().values()) {
    for (const label of model.getLabels()) {
      for (const property of model.getProperties()) {
        if (!property.isTyped()) {
          continue
        }

        const cypherType = cypherPropertyType(property.getType())

        if (cypherType !== undefined) {
          types.set(
            schemaObjectName(label, property.getKey(), ConstraintType.PROPERTY_TYPE),
            cypherType,
          )
        }
      }
    }
  }

  return types
}

/**
CREATE statement for a declared object, built by the same statement
builders the install paths use (NTS-450)
*/
function createStatement(
  object: SchemaObject,
  vectors: Map<string, VectorIndexDefinition>,
  types: Map<string, string>,
): string | undefined {
  const label = object.labelsOrTypes[0] ?? ''

  switch (object.type) {
    case ConstraintType.VECTOR: {
      const definition = vectors.get(object.name)

      return definition === undefined ? undefined : createVectorStatement(definition)
    }
    case ConstraintType.FULLTEXT: {
      return createFulltextStatement({ label, properties: object.properties, name: object.name })
    }
    case ConstraintType.PROPERTY_TYPE: {
      const cypherType = types.get(object.name)

      return cypherType === undefined
        ? undefined
        : propertyTypeStatement(
            ConstraintAction.CREATE,
            label,
            object.properties[0] ?? '',
            cypherType,
            object.name,
          )
    }
    case ConstraintType.UNIQUE:
    case ConstraintType.EXISTS:
    case ConstraintType.INDEX: {
      return schemaStatement(
        ConstraintAction.CREATE,
        object.type,
        label,
        object.properties,
        object.name,
      )
    }
    default: {
      return undefined
    }
  }
}

/**
DROP statement for an installed object, built by the same statement
builders the drop paths use (NTS-450)
*/
function dropStatement(object: SchemaObject): string {
  const label = object.labelsOrTypes[0] ?? ''
  // SHOW's spellings (EXISTENCE, RANGE) normalise onto the declared
  // vocabulary before dispatch
  const type = normaliseType(object.type)

  switch (type) {
    case ConstraintType.VECTOR: {
      return dropVectorStatement(object.name)
    }
    case ConstraintType.FULLTEXT: {
      return dropFulltextStatement(object.name)
    }
    case ConstraintType.UNIQUE:
    case ConstraintType.EXISTS:
    case ConstraintType.PROPERTY_TYPE: {
      return object.properties.length > 0
        ? schemaStatement(ConstraintAction.DROP, type, label, object.properties, object.name)
        : `DROP CONSTRAINT ${object.name} IF EXISTS`
    }
    default: {
      // shortcut: no builder exists for range/text/point index drops,
      // and they all share the plain DROP INDEX spelling — add one per
      // kind if their syntax ever diverges
      return `DROP INDEX ${object.name} IF EXISTS`
    }
  }
}

/**
SHOW INDEXES reports range indexes as RANGE and SHOW CONSTRAINTS reports
existence constraints as EXISTENCE — compare installed objects against
the declared spellings through one normal form
*/
const normaliseType = (type: string): string => {
  const upper = type.toUpperCase()

  if (upper === 'RANGE') {
    return ConstraintType.INDEX
  }

  if (upper === 'EXISTENCE') {
    return ConstraintType.EXISTS
  }

  return upper
}

const hasSameValues = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value) => right.includes(value))

const isSameDefinition = (declared: SchemaObject, installed: SchemaObject): boolean =>
  normaliseType(declared.type) === normaliseType(installed.type) &&
  hasSameValues(declared.labelsOrTypes, installed.labelsOrTypes) &&
  hasSameValues(declared.properties, installed.properties)

// ---- Graph type family (NTS-550) ---------------------------------------------

function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1
  }

  if (a > b) {
    return 1
  }

  return 0
}

/**
`name::TYPE[!]` signature — whitespace-insensitive property comparison
*/
const propertySignature = (property: GraphTypePropertyDefinition): string =>
  `${property.name}::${property.type.replaceAll(' ', '')}${property.nullable === false ? '!' : ''}`

const signatureSet = (properties: GraphTypePropertyDefinition[] | undefined): string[] => {
  const signatures = (properties ?? []).map((property) => propertySignature(property))

  signatures.sort(compareStrings)

  return signatures
}

const sortedCopy = (values: string[]): string[] => {
  const copy = [...values]

  copy.sort(compareStrings)

  return copy
}

const isSameNodeDefinition = (
  declared: GraphTypeNodeDefinition,
  installed: GraphTypeNodeDefinition,
): boolean => {
  const declaredImplies = sortedCopy(declared.implies ?? [])
  const installedImplies = sortedCopy(installed.implies ?? [])

  return (
    hasSameValues(declaredImplies, installedImplies) &&
    hasSameValues(signatureSet(declared.properties), signatureSet(installed.properties))
  )
}

const isSameRelationshipDefinition = (
  declared: GraphTypeRelationshipDefinition,
  installed: GraphTypeRelationshipDefinition,
): boolean =>
  declared.source === installed.source &&
  declared.target === installed.target &&
  hasSameValues(signatureSet(declared.properties), signatureSet(installed.properties))

const isSameConstraintContent = (
  declared: GraphTypeConstraintDefinition,
  installed: GraphTypeConstraintDefinition,
): boolean =>
  declared.kind === installed.kind &&
  declared.labelOrType === installed.labelOrType &&
  (declared.relationship === true) === (installed.relationship === true) &&
  (declared.kind !== 'TYPE' || declared.type === installed.type) &&
  hasSameValues(sortedCopy(declared.properties), sortedCopy(installed.properties))

/**
Diff the installed graph type against the derived definition, per element
(nodes and relationship element types by identifying label/type, named
constraint items by content — the server generates names for the unnamed
ones). Fix statements reuse the statement builders: ADD for missing
elements, DROP for stale, ALTER for redefinitions.
*/
function graphTypeDriftGroup(
  installed: GraphTypeDefinition,
  declared: GraphTypeDefinition,
  installedSpecification: string | undefined,
): GraphTypeDrift {
  const missing: SchemaDriftEntry[] = []
  const stale: SchemaDriftEntry[] = []
  const mismatched: SchemaDriftEntry[] = []
  const base = { type: ConstraintType.GRAPH_TYPE } as const

  const installedNodes = new Map(installed.nodes.map((node) => [node.label, node]))
  const declaredNodes = new Map(declared.nodes.map((node) => [node.label, node]))

  for (const [label, node] of declaredNodes) {
    const installedNode = installedNodes.get(label)

    if (installedNode === undefined) {
      missing.push({
        ...base,
        name: label,
        labelsOrTypes: [label],
        properties: (node.properties ?? []).map((property) => property.name),
        createStatement: graphTypeAddStatement({ nodes: [node], relationships: [] }),
      })
    } else if (!isSameNodeDefinition(node, installedNode)) {
      mismatched.push({
        ...base,
        name: label,
        labelsOrTypes: [label],
        properties: (node.properties ?? []).map((property) => property.name),
        createStatement: graphTypeAlterStatement({ nodes: [node], relationships: [] }),
        dropStatement: graphTypeDropStatement({ nodes: [{ label }], relationships: [] }),
      })
    }
  }

  for (const [label, node] of installedNodes) {
    if (!declaredNodes.has(label)) {
      stale.push({
        ...base,
        name: label,
        labelsOrTypes: [label],
        properties: (node.properties ?? []).map((property) => property.name),
        dropStatement: graphTypeDropStatement({ nodes: [{ label }], relationships: [] }),
      })
    }
  }

  const installedRelationships = new Map(
    (installed.relationships ?? []).map((relationship) => [relationship.type, relationship]),
  )
  const declaredRelationships = new Map(
    (declared.relationships ?? []).map((relationship) => [relationship.type, relationship]),
  )

  for (const [type, relationship] of declaredRelationships) {
    const installedRelationship = installedRelationships.get(type)

    if (installedRelationship === undefined) {
      missing.push({
        ...base,
        name: type,
        labelsOrTypes: [type],
        properties: (relationship.properties ?? []).map((property) => property.name),
        createStatement: graphTypeAddStatement({ nodes: [], relationships: [relationship] }),
      })
    } else if (!isSameRelationshipDefinition(relationship, installedRelationship)) {
      mismatched.push({
        ...base,
        name: type,
        labelsOrTypes: [type],
        properties: (relationship.properties ?? []).map((property) => property.name),
        createStatement: graphTypeAlterStatement({ nodes: [], relationships: [relationship] }),
        dropStatement: graphTypeDropStatement({ nodes: [], relationships: [{ type }] }),
      })
    }
  }

  for (const [type, relationship] of installedRelationships) {
    if (!declaredRelationships.has(type)) {
      stale.push({
        ...base,
        name: type,
        labelsOrTypes: [type],
        properties: (relationship.properties ?? []).map((property) => property.name),
        dropStatement: graphTypeDropStatement({ nodes: [], relationships: [{ type }] }),
      })
    }
  }

  const installedConstraints = installed.constraints ?? []
  const declaredConstraints = declared.constraints ?? []

  for (const constraint of declaredConstraints) {
    const isAbsent = installedConstraints.every(
      (installed_) => !isSameConstraintContent(constraint, installed_),
    )

    if (isAbsent) {
      missing.push({
        ...base,
        name: constraint.name ?? graphTypeConstraintName(constraint),
        labelsOrTypes: [constraint.labelOrType],
        properties: constraint.properties,
        createStatement: graphTypeAddStatement({
          nodes: [],
          relationships: [],
          constraints: [constraint],
        }),
      })
    }
  }

  for (const constraint of installedConstraints) {
    const isUndeclared = declaredConstraints.every(
      (declared_) => !isSameConstraintContent(declared_, constraint),
    )

    if (isUndeclared) {
      stale.push({
        ...base,
        name: constraint.name ?? '',
        labelsOrTypes: [constraint.labelOrType],
        properties: constraint.properties,
        dropStatement: graphTypeDropStatement({
          nodes: [],
          relationships: [],
          constraints: [constraint],
        }),
      })
    }
  }

  return {
    installed: installedSpecification,
    declaredStatement: graphTypeSetStatement(declared),
    missing,
    stale,
    mismatched,
  }
}

function driftGroup(
  group: SchemaDiff,
  vectors: Map<string, VectorIndexDefinition>,
  types: Map<string, string>,
): SchemaDriftGroup {
  const installedByName = new Map(group.installed.map((object) => [object.name, object]))
  const declaredNames = new Set(group.declared.map((object) => object.name))
  const installedNames = new Set(group.installed.map((object) => object.name))

  const missing = group.declared
    .filter((object) => !installedNames.has(object.name))
    .map(
      (object): SchemaDriftEntry => ({
        name: object.name,
        type: object.type,
        labelsOrTypes: object.labelsOrTypes,
        properties: object.properties,
        createStatement: createStatement(object, vectors, types),
      }),
    )

  const stale = group.installed
    .filter((object) => !declaredNames.has(object.name))
    .map(
      (object): SchemaDriftEntry => ({
        name: object.name,
        type: object.type,
        labelsOrTypes: object.labelsOrTypes,
        properties: object.properties,
        dropStatement: dropStatement(object),
      }),
    )

  const mismatched = group.declared
    .map((object) => ({ declared: object, installed: installedByName.get(object.name) }))
    .filter(
      (pair): pair is { declared: SchemaObject; installed: SchemaObject } =>
        pair.installed !== undefined && !isSameDefinition(pair.declared, pair.installed),
    )
    .map(
      (pair): SchemaDriftEntry => ({
        name: pair.declared.name,
        type: pair.declared.type,
        labelsOrTypes: pair.declared.labelsOrTypes,
        properties: pair.declared.properties,
        createStatement: createStatement(pair.declared, vectors, types),
        dropStatement: dropStatement(pair.installed),
      }),
    )

  return { missing, stale, mismatched }
}

/**
Structured schema drift (NTS-450): the declared-vs-installed inspection
of constraints and every index kind (range/text/fulltext/vector), with
the exact fix statement per entry.

Cheap and drift-never-throws: drift is data, not an error — failing a
CI run on a non-empty diff is the caller's job.
*/
export async function schemaDrift(
  connection: ConnectionProvider,
  options: InspectOptions = {},
): Promise<SchemaDrift> {
  const declaredVectors = [...declaredVectorDefinitions(), ...(options.vector ?? [])]

  const inspection = await inspectSchema(connection, {
    ...options,
    fulltext: [...declaredFulltextDefinitions(), ...(options.fulltext ?? [])],
    vector: declaredVectors,
  })

  const vectors = new Map(
    declaredVectors.map((definition) => [vectorIndexName(definition), definition]),
  )
  const types = declaredPropertyTypes()

  // NTS-550 — the graph type family: probe SHOW CURRENT GRAPH TYPE and diff
  // the installed specification against the derived definition. Backends
  // without graph type support (Community, pre-2026.02, embedded engines)
  // make the probe throw — the family is omitted from the report, keeping
  // drift cheap and never-throwing for everyone else.
  let graphType: GraphTypeDrift | undefined

  try {
    const specification = await currentGraphType(connection)

    graphType = graphTypeDriftGroup(
      specification === undefined
        ? { nodes: [], relationships: [] }
        : parseGraphTypeSpecification(specification),
      deriveGraphType(
        options.graphTypeConstraints === undefined
          ? {}
          : { constraints: options.graphTypeConstraints },
      ),
      specification,
    )
  } catch {
    // Graph types unsupported here — no family reported
  }

  return {
    constraints: driftGroup(inspection.constraints, vectors, types),
    indexes: driftGroup(inspection.indexes, vectors, types),
    ...(graphType !== undefined && { graphType }),
  }
}

/**
Human-readable multi-line drift report, grouped by action (missing /
stale / mismatched), one line per object plus its fix statement.
Pure function — no database access (NTS-450).
*/
export function formatSchemaDrift(drift: SchemaDrift): string {
  const groups: [string, SchemaDriftEntry[], string][] = [
    [
      'missing',
      [...drift.constraints.missing, ...drift.indexes.missing, ...(drift.graphType?.missing ?? [])],
      'declared but not installed',
    ],
    [
      'stale',
      [...drift.constraints.stale, ...drift.indexes.stale, ...(drift.graphType?.stale ?? [])],
      'installed but not declared',
    ],
    [
      'mismatched',
      [
        ...drift.constraints.mismatched,
        ...drift.indexes.mismatched,
        ...(drift.graphType?.mismatched ?? []),
      ],
      'installed definition differs from the declaration',
    ],
  ]

  const lines: string[] = []

  if (drift.graphType !== undefined) {
    lines.push(
      `graph type ${drift.graphType.installed === undefined ? '(none installed)' : '(installed)'}`,
    )
  }

  for (const [action, entries, note] of groups) {
    if (entries.length === 0) {
      continue
    }

    lines.push(`${action} (${String(entries.length)}) — ${note}:`)

    for (const entry of entries) {
      const where = entry.labelsOrTypes.map((label) => `:${label}`).join('')
      lines.push(`  - ${entry.type} ${entry.name} on ${where} (${entry.properties.join(', ')})`)

      if (entry.createStatement !== undefined) {
        lines.push(`      fix: ${entry.createStatement}`)
      }

      if (entry.dropStatement !== undefined) {
        // mismatched entries need both statements; stale ones are
        // only applied with the explicit dropStale flag
        lines.push(
          entry.createStatement === undefined
            ? `      fix (requires dropStale: true): ${entry.dropStatement}`
            : `      drop first: ${entry.dropStatement}`,
        )
      }
    }
  }

  return lines.length === 0
    ? 'no schema drift: the declared schema matches the database'
    : lines.join('\n')
}

/**
Apply the missing objects of a drift idempotently — every CREATE
carries IF NOT EXISTS. Stale objects are only dropped with
`dropStale: true` (dropping is destructive). Mismatched objects are
never applied automatically. Each statement is reported with a
SchemaResult, following the SchemaService pattern (NTS-450).
*/
export async function applySchemaDrift(
  connection: ConnectionProvider,
  drift: SchemaDrift,
  options: ApplySchemaDiffOptions = {},
): Promise<SchemaResult[]> {
  const targets: { action: ConstraintAction; entry: SchemaDriftEntry; statement: string }[] = []

  for (const group of [drift.constraints, drift.indexes]) {
    for (const entry of group.missing) {
      if (entry.createStatement !== undefined) {
        targets.push({ action: ConstraintAction.CREATE, entry, statement: entry.createStatement })
      }
    }

    if (options.dropStale === true) {
      for (const entry of group.stale) {
        if (entry.dropStatement !== undefined) {
          targets.push({ action: ConstraintAction.DROP, entry, statement: entry.dropStatement })
        }
      }
    }
  }

  // Sequential: Neo4j can abort concurrent schema writes (schema-lock
  // contention), so drift application never runs DDL in parallel
  const results: SchemaResult[] = []

  for (const { action, entry, statement } of targets) {
    const result: SchemaResult = {
      action,
      // stale objects report the type SHOW gave them (RANGE, TEXT,
      // …), which has no declared equivalent to name instead
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- reporting-only field
      type: entry.type as ConstraintType,
      label: entry.labelsOrTypes[0] ?? '',
      property: entry.properties[0] ?? '',
      statement,
      success: false,
    }

    if (entry.properties.length > 1) {
      result.properties = entry.properties
    }

    try {
      await connection.run(statement, {}, 'WRITE')

      result.success = true
    } catch (error) {
      result.error = error instanceof Error ? error : new Error(String(error))
    }

    results.push(result)
  }

  return results
}
