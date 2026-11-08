/**
Graph type support (NTS-548): derive a Neo4j graph type (Cypher 25,
Enterprise Edition, 2026.02+) from the registered models and apply it with
`ALTER CURRENT GRAPH TYPE SET { ... }` / `ALTER CURRENT GRAPH TYPE DROP { ... }`.

Complements installSchema() (constraints + indexes) as its own method: a
graph type SET replaces the database's existing graph type and constraints,
so it is deliberately never merged into the installSchema() flow.

https://neo4j.com/docs/cypher-manual/current/schema/graph-types/
*/
import type { ConnectionProvider } from '../../driver/types.js'
import { EntityType, type EntitySchema } from '../../meta/entity/entity-schema.js'
import { getModel, getModels } from '../../meta/index.js'
import type { PropertySchema } from '../../meta/property-schema.js'
import { PropertyType } from '../../meta/property-schema.js'
import { Direction } from '../../query/direction.js'
import { quote } from '../../query/quote.js'
import {
  ConstraintAction,
  ConstraintType,
  cypherPropertyType,
  type SchemaResult,
} from './schema-objects.js'

/**
One property of a node/relationship element type: rendered `name :: TYPE`,
plus `NOT NULL` when `nullable` is false and `IS UNIQUE` when `unique`
*/
export interface GraphTypePropertyDefinition {
  name: string
  /**
  Cypher property type, e.g. STRING — as produced by cypherPropertyType()
  */
  type: string
  nullable?: boolean
  unique?: boolean
}

/**
Node element type: `(:Label => :Implied1&:Implied2 { ... })`
*/
export interface GraphTypeNodeDefinition {
  label: string
  implies?: string[]
  properties?: GraphTypePropertyDefinition[]
}

/**
Relationship element type: `(:Source)-[:TYPE => { ... }]->(:Target)`.
Both ends optional (BOTH-direction relationships render bare ends)
*/
export interface GraphTypeRelationshipDefinition {
  type: string
  source?: string
  target?: string
  properties?: GraphTypePropertyDefinition[]
}

/**
A complete graph type: the shape derived from the registered models
*/
export interface GraphTypeDefinition {
  nodes: GraphTypeNodeDefinition[]
  relationships?: GraphTypeRelationshipDefinition[]
}

const renderProperty = (property: GraphTypePropertyDefinition): string =>
  `${quote(property.name)} :: ${property.type}` +
  (property.nullable === false ? ' NOT NULL' : '') +
  (property.unique === true ? ' IS UNIQUE' : '')

const renderNode = (node: GraphTypeNodeDefinition): string => {
  const implied =
    node.implies === undefined || node.implies.length === 0
      ? ''
      : `:${node.implies.map((label) => quote(label)).join('&')}`

  const properties =
    node.properties === undefined || node.properties.length === 0
      ? ''
      : `{${node.properties.map((property) => renderProperty(property)).join(', ')}}`

  const body = [implied, properties].filter((part) => part !== '').join(' ')

  // The identifying label's `:` marker is mandatory, as is the `=>` —
  // even with no implied labels or properties after them
  return `(:${quote(node.label)}${body === '' ? ' =>' : ` => ${body}`})`
}

const renderRelationship = (relationship: GraphTypeRelationshipDefinition): string => {
  const properties =
    relationship.properties === undefined || relationship.properties.length === 0
      ? ''
      : `{${relationship.properties.map((property) => renderProperty(property)).join(', ')}}`

  return (
    `(${relationship.source === undefined ? '' : `:${quote(relationship.source)}`})` +
    `-[:${quote(relationship.type)} =>${properties === '' ? '' : ` ${properties}`}]->` +
    `(${relationship.target === undefined ? '' : `:${quote(relationship.target)}`})`
  )
}

const elements = (definition: GraphTypeDefinition): string[] => [
  ...definition.nodes.map((node) => renderNode(node)),
  ...(definition.relationships ?? []).map((relationship) => renderRelationship(relationship)),
]

/**
`ALTER CURRENT GRAPH TYPE SET { ... }` — replaces the database's existing
graph type and constraints
*/
export function graphTypeSetStatement(definition: GraphTypeDefinition): string {
  const statements = elements(definition)

  if (statements.length === 0) {
    throw new TypeError(
      'Cannot set a graph type: no node or relationship element types derived from the registered models',
    )
  }

  return `ALTER CURRENT GRAPH TYPE SET {${statements.join(', ')}}`
}

/**
`ALTER CURRENT GRAPH TYPE DROP { ... }` — drops the element types by
identifying label/relationship type (dropping an element type drops the
constraints it enforced)
*/
export function graphTypeDropStatement(definition: GraphTypeDefinition): string {
  const statements = [
    ...definition.nodes.map((node) => `(:${quote(node.label)} =>)`),
    ...(definition.relationships ?? []).map(
      (relationship) => `()-[:${quote(relationship.type)} =>]->()`,
    ),
  ]

  if (statements.length === 0) {
    throw new TypeError(
      'Cannot drop a graph type: no node or relationship element types derived from the registered models',
    )
  }

  return `ALTER CURRENT GRAPH TYPE DROP {${statements.join(', ')}}`
}

/**
Mappable property columns of an element type: declared properties with a
Cypher type equivalent, typed and flagged. NUMBER (spans INTEGER + FLOAT),
ANY and the structural/projected property types have no Cypher equivalent
and are skipped
*/
const graphTypeProperties = (properties: PropertySchema[]): GraphTypePropertyDefinition[] => {
  const output: GraphTypePropertyDefinition[] = []

  for (const property of properties) {
    const type = cypherPropertyType(property.getType())

    if (type === undefined) {
      continue
    }

    output.push({
      name: property.getKey(),
      // The element type spellings of list types carry NOT NULL inside the
      // brackets (the list elements cannot be null)
      type: property.isArray() ? `LIST<${type} NOT NULL>` : type,
      ...((property.isRequired() || property.isExists()) && { nullable: false }),
      ...(property.isUnique() && { unique: true }),
    })
  }

  return output
}

/**
The label at the far end of a relationship declared against a relationship
entity: the node model held by the entity's @StartNode/@EndNode property
(mirrors getOtherProperty in write-utilities)
*/
const relationshipEntityFarLabel = (
  targetSchema: EntitySchema,
  direction: Direction,
): { label?: string; properties: GraphTypePropertyDefinition[] } => {
  const farProperty = targetSchema
    .getProperties()
    .find((property) =>
      direction === Direction.INCOMING
        ? property.getType() === PropertyType.START_NODE ||
          property.getType() === PropertyType.OTHER_NODE
        : property.getType() === PropertyType.END_NODE ||
          property.getType() === PropertyType.OTHER_NODE,
    )

  const entity = farProperty?.getEntity()
  const farSchema = entity === undefined ? undefined : getModel(entity)
  const farLabel = farSchema?.getLabels()[0]

  return {
    ...(farLabel !== undefined && { label: farLabel }),
    properties: graphTypeProperties(targetSchema.getProperties()),
  }
}

const relationshipElementType = (
  relationshipType: string,
  direction: Direction,
  thisLabel: string,
  farLabel: string | undefined,
  properties: GraphTypePropertyDefinition[],
): GraphTypeRelationshipDefinition | undefined => {
  if (direction === Direction.BOTH) {
    // Bare ends: pinning one would forbid the direction the OGM allows
    return {
      type: relationshipType,
      ...(properties.length > 0 && { properties }),
    }
  }

  const [source, target] =
    direction === Direction.INCOMING ? [farLabel, thisLabel] : [thisLabel, farLabel]

  // An element type needs a non-empty end or a non-empty property map
  if (source === undefined && target === undefined && properties.length === 0) {
    return undefined
  }

  return {
    type: relationshipType,
    ...(source !== undefined && { source }),
    ...(target !== undefined && { target }),
    ...(properties.length > 0 && { properties }),
  }
}

/**
Derive the graph type from the registered models (the same walk the
ontology emits): node models become node element types (first label
identifies, the rest are implied), their relationship declarations become
relationship element types. Duplicate identifying labels/types: first model
wins — anything the server rejects surfaces in the SchemaResult error
*/
export function deriveGraphType(): GraphTypeDefinition {
  const nodes: GraphTypeNodeDefinition[] = []
  const relationships: GraphTypeRelationshipDefinition[] = []
  const seenLabels = new Set<string>()
  const seenTypes = new Set<string>()

  for (const model of getModels().values()) {
    if (model.getType() !== EntityType.NodeEntity) {
      // Relationship entities only contribute properties to the element
      // type of the declaration that targets them (their own labels are
      // unused — the declaring model's relationship type names the edge)
      continue
    }

    const [label, ...implied] = model.getLabels()

    if (label !== undefined && !seenLabels.has(label)) {
      seenLabels.add(label)

      const properties = graphTypeProperties(model.getProperties())

      // A node element type requires implied labels or a non-empty
      // property map — skip bare-label models the server would reject
      if (implied.length > 0 || properties.length > 0) {
        nodes.push({
          label,
          ...(implied.length > 0 && { implies: implied }),
          ...(properties.length > 0 && { properties }),
        })
      }
    }

    for (const relationship of model.getRelationships()) {
      const type = relationship.getType()

      if (type === '' || seenTypes.has(type)) {
        continue
      }

      seenTypes.add(type)

      const direction = relationship.getDirection()
      let farLabel: string | undefined
      let properties: GraphTypePropertyDefinition[] = []

      try {
        const targetSchema = getModel(relationship.getTarget())

        if (targetSchema.getType() === EntityType.RelationshipEntity) {
          const far = relationshipEntityFarLabel(targetSchema, direction)
          farLabel = far.label
          properties = far.properties
        } else {
          farLabel = targetSchema.getLabels()[0]
        }
      } catch {
        // No resolvable target: the declaration relates to any end
      }

      const elementType = relationshipElementType(
        type,
        direction,
        label ?? '',
        farLabel,
        properties,
      )

      if (elementType !== undefined) {
        relationships.push(elementType)
      }
    }
  }

  return { nodes, relationships }
}

/**
The one-statement result shape, with the statement reported even when it
could not run (enterprise gating)
*/
function graphTypeResult(action: ConstraintAction, statement: string): SchemaResult {
  return {
    action,
    type: ConstraintType.GRAPH_TYPE,
    label: '',
    property: '',
    statement,
    success: false,
  }
}

function graphTypeUnsupported(action: ConstraintAction): SchemaResult {
  return {
    ...graphTypeResult(
      action,
      `-- ALTER CURRENT GRAPH TYPE ${action === ConstraintAction.CREATE ? 'SET' : 'DROP'} { ... }`,
    ),
    error: new Error(
      'Graph types are Enterprise Edition only (Neo4j 2026.02+): enable the enterprise flag ' +
        '(new Neode(connection, true) / NEO4J_ENTERPRISE=true / setEnterprise(true)) before installing',
    ),
  }
}

/**
Applies the model-derived graph type with one SET/DROP statement, following
the same result-reporting pattern as the other schema services
*/
export class GraphTypeService {
  private readonly connection: ConnectionProvider
  private readonly enterprise: boolean

  constructor(connection: ConnectionProvider, isEnterprise = false) {
    this.connection = connection
    this.enterprise = isEnterprise
  }

  private async run(action: ConstraintAction, statement: string): Promise<SchemaResult[]> {
    const result = graphTypeResult(action, statement)

    try {
      await this.connection.run(statement, {}, 'WRITE')

      result.success = true
    } catch (error) {
      result.error = error instanceof Error ? error : new Error(String(error))
    }

    return [result]
  }

  async create(): Promise<SchemaResult[]> {
    return this.enterprise
      ? this.run(ConstraintAction.CREATE, graphTypeSetStatement(deriveGraphType()))
      : [graphTypeUnsupported(ConstraintAction.CREATE)]
  }

  async drop(): Promise<SchemaResult[]> {
    return this.enterprise
      ? this.run(ConstraintAction.DROP, graphTypeDropStatement(deriveGraphType()))
      : [graphTypeUnsupported(ConstraintAction.DROP)]
  }
}
