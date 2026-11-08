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
  schemaObjectName,
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
  /**
  NTS-549 — named `CONSTRAINT ... FOR ... REQUIRE` items: uniqueness/key
  constraints hoisted out of the element types (explicitly named, so the
  name is addressable in `ALTER CURRENT GRAPH TYPE DROP` / `DROP CONSTRAINT`)
  and constraints on labels/types that are not identifying ones (derivation
  cannot produce those — pass them to installGraphType())
  */
  constraints?: GraphTypeConstraintDefinition[]
}

/**
What the constraint enforces: uniqueness, key (existence + uniqueness),
property existence, or property type
*/
export type GraphTypeConstraintKind = 'UNIQUE' | 'KEY' | 'EXISTS' | 'TYPE'

/**
NTS-549 — one named constraint item of a graph type
*/
export interface GraphTypeConstraintDefinition {
  /**
  Explicit name — generated deterministically when omitted
  */
  name?: string
  /**
  Node label, or relationship type when `relationship` is true
  */
  labelOrType: string
  /**
  On a relationship type rather than a node label
  */
  relationship?: boolean
  /**
  Constrained properties (EXISTS and TYPE take exactly one)
  */
  properties: string[]
  kind: GraphTypeConstraintKind
  /**
  For kind TYPE: the enforced Cypher property type
  */
  type?: string
}

/**
Deterministic name for a graph type constraint item (the same
`<label>_<props>_<kind>` shape as the standalone constraint names)
*/
export const graphTypeConstraintName = (constraint: GraphTypeConstraintDefinition): string =>
  schemaObjectName(
    constraint.labelOrType,
    constraint.properties.map((property) => property.toLowerCase()).join('_'),
    constraint.kind.toLowerCase(),
  )

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
The predicate right of `REQUIRE`, per constraint kind
*/
const constraintPredicate = (constraint: GraphTypeConstraintDefinition): string => {
  switch (constraint.kind) {
    case 'UNIQUE': {
      return 'IS UNIQUE'
    }
    case 'KEY': {
      return 'IS KEY'
    }
    case 'EXISTS': {
      return 'IS NOT NULL'
    }
    case 'TYPE': {
      return `IS :: ${constraint.type ?? ''}`.trimEnd()
    }
  }
}

/**
`CONSTRAINT [name] FOR (n:Label)|()-[r:TYPE]->() REQUIRE ... IS ...` —
NTS-549. Property existence/type constraints are single-property (server
rule); uniqueness/key take one or more (composites, NTS-552)
*/
const renderConstraint = (constraint: GraphTypeConstraintDefinition): string => {
  if (constraint.properties.length === 0) {
    throw new TypeError(
      `Graph type constraint on "${constraint.labelOrType}" declares no properties`,
    )
  }

  if (
    (constraint.kind === 'EXISTS' || constraint.kind === 'TYPE') &&
    constraint.properties.length > 1
  ) {
    throw new TypeError(
      `Graph type ${constraint.kind} constraint on "${constraint.labelOrType}" takes exactly one property`,
    )
  }

  const variable = constraint.relationship === true ? 'r' : 'n'
  const target =
    constraint.relationship === true
      ? `()-[${variable}:${quote(constraint.labelOrType)}]->()`
      : `(${variable}:${quote(constraint.labelOrType)})`
  // One parenthesised list — the server's canonical spelling for both the
  // single (`(n.address)`) and composite (`(n.name, n.ssn)`) forms
  const properties = constraint.properties
    .map((property) => `${variable}.${quote(property)}`)
    .join(', ')

  return `CONSTRAINT ${quote(constraint.name ?? graphTypeConstraintName(constraint))} FOR ${target} REQUIRE (${properties}) ${constraintPredicate(constraint)}`
}

/**
The definition's constraint items, validated for name collisions
*/
const constraintItems = (definition: GraphTypeDefinition): string[] => {
  const items = definition.constraints ?? []

  return items.map((constraint) => renderConstraint(constraint))
}

/**
`ALTER CURRENT GRAPH TYPE SET { ... }` — replaces the database's existing
graph type and constraints
*/
export function graphTypeSetStatement(definition: GraphTypeDefinition): string {
  const statements = [...elements(definition), ...constraintItems(definition)]

  if (statements.length === 0) {
    throw new TypeError(
      'Cannot set a graph type: no node or relationship element types derived from the registered models',
    )
  }

  return `ALTER CURRENT GRAPH TYPE SET {${statements.join(', ')}}`
}

/**
`ALTER CURRENT GRAPH TYPE DROP { ... }` — drops the element types by
identifying label/relationship type plus every named constraint item.
Dropping an element type removes its dependent constraints (label
existence, property type/existence) but LEAVES its uniqueness/key
constraints — those survive as constraints on non-identifying labels and
must go by name.
*/
export function graphTypeDropStatement(definition: GraphTypeDefinition): string {
  const statements = [
    ...definition.nodes.map((node) => `(:${quote(node.label)} =>)`),
    ...(definition.relationships ?? []).map(
      (relationship) => `()-[:${quote(relationship.type)} =>]->()`,
    ),
    ...(definition.constraints ?? []).map(
      (constraint) => `CONSTRAINT ${quote(constraint.name ?? graphTypeConstraintName(constraint))}`,
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
NTS-552 — composite `REQUIRE (n.a, n.b) IS ...` constraint groups of a
model: `compositeUnique` → IS UNIQUE, `compositeIndex` → IS KEY (a graph
type enforces rather than indexes — KEY, the strongest composite
constraint, is the closest graph-type equivalent of a composite index).
Declared on any of the group's properties; deduplicated per property list.
*/
const compositeConstraintGroups = (
  labelOrType: string,
  isRelationship: boolean,
  properties: PropertySchema[],
): GraphTypeConstraintDefinition[] => {
  const groups: GraphTypeConstraintDefinition[] = []
  const seen = new Set<string>()

  const declare = (members: string[] | undefined, kind: 'UNIQUE' | 'KEY'): void => {
    if (members === undefined || members.length === 0) {
      return
    }

    // Deduplicated by the declared property list; a group declared on more
    // than one of its properties repeats the same list
    const key = `${kind}:${members.join(',')}`

    if (seen.has(key)) {
      return
    }

    seen.add(key)

    groups.push({ labelOrType, relationship: isRelationship, properties: members, kind })
  }

  for (const property of properties) {
    declare(property.getCompositeUnique(), 'UNIQUE')
    declare(property.getCompositeIndex(), 'KEY')
  }

  return groups
}

/**
NTS-549 — hoist `unique: true` properties out of an element type's
property map into explicitly named constraint items: the name is what
`DROP CONSTRAINT` / `ALTER CURRENT GRAPH TYPE DROP` addresses, and inline
uniqueness is only nameable by the server's generated names
*/
const hoistUniqueness = (
  labelOrType: string,
  isRelationship: boolean,
  properties: GraphTypePropertyDefinition[],
): { properties: GraphTypePropertyDefinition[]; constraints: GraphTypeConstraintDefinition[] } => {
  const kept: GraphTypePropertyDefinition[] = []
  const constraints: GraphTypeConstraintDefinition[] = []

  for (const property of properties) {
    if (property.unique === true) {
      constraints.push({
        labelOrType,
        relationship: isRelationship,
        properties: [property.name],
        kind: 'UNIQUE',
      })
    } else {
      kept.push(property)
    }
  }

  return { properties: kept, constraints }
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
relationship element types. Uniqueness is hoisted into named constraint
items (NTS-549). Duplicate identifying labels/types: first model wins —
anything the server rejects surfaces in the SchemaResult error.

`options.constraints` appends user-declared constraint items — the only
way to constrain labels/types that are not identifying ones (NTS-549).
*/
export function deriveGraphType(
  options: { constraints?: GraphTypeConstraintDefinition[] } = {},
): GraphTypeDefinition {
  const nodes: GraphTypeNodeDefinition[] = []
  const relationships: GraphTypeRelationshipDefinition[] = []
  const constraints: GraphTypeConstraintDefinition[] = []
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

      // Bare-label skip is judged on the mappable properties BEFORE
      // uniqueness hoisting — a single @Unique property still yields an
      // element type (its property map just carries no type flags)
      const mappable = graphTypeProperties(model.getProperties())
      const hoisted = hoistUniqueness(label, false, mappable)

      constraints.push(
        ...hoisted.constraints,
        ...compositeConstraintGroups(label, false, model.getProperties()),
      )

      // A node element type requires implied labels or a non-empty
      // property map — skip bare-label models the server would reject
      if (implied.length > 0 || mappable.length > 0) {
        nodes.push({
          label,
          ...(implied.length > 0 && { implies: implied }),
          ...(hoisted.properties.length > 0 && { properties: hoisted.properties }),
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
      let relationshipEntityProperties: PropertySchema[] = []

      try {
        const targetSchema = getModel(relationship.getTarget())

        if (targetSchema.getType() === EntityType.RelationshipEntity) {
          const far = relationshipEntityFarLabel(targetSchema, direction)
          farLabel = far.label
          properties = far.properties
          relationshipEntityProperties = targetSchema.getProperties()
        } else {
          farLabel = targetSchema.getLabels()[0]
        }
      } catch {
        // No resolvable target: the declaration relates to any end
      }

      const hoisted = hoistUniqueness(type, true, properties)

      constraints.push(
        ...hoisted.constraints,
        ...compositeConstraintGroups(type, true, relationshipEntityProperties),
      )

      const elementType = relationshipElementType(
        type,
        direction,
        label ?? '',
        farLabel,
        hoisted.properties,
      )

      if (elementType !== undefined) {
        relationships.push(elementType)
      }
    }
  }

  return { nodes, relationships, constraints: [...constraints, ...(options.constraints ?? [])] }
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

  async create(
    options: { constraints?: GraphTypeConstraintDefinition[] } = {},
  ): Promise<SchemaResult[]> {
    return this.enterprise
      ? this.run(ConstraintAction.CREATE, graphTypeSetStatement(deriveGraphType(options)))
      : [graphTypeUnsupported(ConstraintAction.CREATE)]
  }

  async drop(
    options: { constraints?: GraphTypeConstraintDefinition[] } = {},
  ): Promise<SchemaResult[]> {
    return this.enterprise
      ? this.run(ConstraintAction.DROP, graphTypeDropStatement(deriveGraphType(options)))
      : [graphTypeUnsupported(ConstraintAction.DROP)]
  }
}
