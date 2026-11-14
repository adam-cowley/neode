/**
Graph type support (NTS-548): derive a Neo4j graph type (Cypher 25,
Enterprise Edition, 2026.02+) from the registered models and apply it with
`ALTER CURRENT GRAPH TYPE ADD { ... }` (default, non-destructive), `SET`
(opt-in replace) and `DROP { ... }`.

Complements installSchema() (constraints + indexes) as its own method: a
graph type SET replaces the database's existing graph type and constraints,
so it is opt-in (NTS-578) and never merged into the installSchema() flow.

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
`<label>_<props>_<kind>_<hash>` shape as the standalone constraint names)
*/
export const graphTypeConstraintName = (constraint: GraphTypeConstraintDefinition): string =>
  schemaObjectName(constraint.labelOrType, constraint.properties, constraint.kind)

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

// ---- Parsing the server's canonical specification (NTS-550) ------------------
//
// `SHOW CURRENT GRAPH TYPE` returns one `specification` string in a
// canonical form: `\r\n`-separated lines, backticked identifiers, every
// uniqueness/key constraint hoisted into its own `CONSTRAINT ... FOR ...
// REQUIRE ...` line (with generated names when not explicitly named), and
// relationship ends rendered as abbreviated node element types
// (`(:`Label` =>)` when the end is an element type's identifying label,
// `(:`Label`)` when it is a plain label, `()` when unconstrained).

const NODE_SPEC_PATTERN =
  /^\(\s*(?:`(\w+)`\s*)?:\s*`([^`]+)`\s*=>\s*(?::\s*([^{}]*?))?\s*(?:\{(.*)\})?\s*\)$/

const RELATIONSHIP_SPEC_PATTERN =
  /^\(\s*(?::\s*(?:`([^`]+)`\s*(?:=>\s*)?)?)?\)\s*-\[\s*:\s*`([^`]+)`\s*(?:=>\s*(?:\{(.*)\})?\s*)?\]->\(\s*(?::\s*(?:`([^`]+)`\s*(?:=>\s*)?)?)?\)$/

const CONSTRAINT_SPEC_PATTERN =
  /^CONSTRAINT\s*`([^`]+)`\s*FOR\s*(?:\(\)\s*-\[\s*`?(\w+)`?\s*:\s*`?(\w+)`?\s*\]\s*->\s*\(\)|\(\s*(?:`?(\w+)`?\s*)?:\s*`([^`]+)`\s*(?:=>\s*)?\))\s*REQUIRE\s*\((.*)\)\s*(IS\s+UNIQUE|IS\s+KEY|IS\s+NOT\s+NULL|IS\s*::\s*.+)$/i

const PROPERTY_SPEC_PATTERN = /`?(\w+)`?\s*\.\s*`?(\w+)`?/g

const parseSpecProperties = (body = ''): GraphTypePropertyDefinition[] => {
  if (body === '') {
    return []
  }

  return body.split(',').map((part) => {
    const match = /^\s*`([^`]+)`\s*::\s*(.+?)(?:\s+NOT NULL)?\s*$/.exec(part)

    if (match === null) {
      throw new TypeError(`Cannot parse graph type property specification: "${part.trim()}"`)
    }

    const [, name = '', type = ''] = match

    return {
      name,
      type,
      // `NOT NULL` only lands the flag at the END — `LIST<STRING NOT NULL>`
      // carries it inside the brackets (list-element nullability, not the
      // property's)
      ...(part.trimEnd().endsWith('NOT NULL') && { nullable: false }),
    }
  })
}

const parseSpecImplied = (body = ''): string[] | undefined => {
  const implied = body
    .split('&')
    .map((label) => label.trim().replaceAll('`', ''))
    .filter((label) => label.length > 0)

  return implied.length > 0 ? implied : undefined
}

const parseSpecConstraint = (match: RegExpExecArray): GraphTypeConstraintDefinition => {
  // 1 = name, 2 = relationship variable, 3 = relationship type,
  // 4 = node binding variable, 5 = node label, 6 = REQUIRE body,
  // 7 = predicate — capture groups are `string | undefined` at runtime
  const [, name = '', , relationshipType, , nodeLabel = '', requireBody = '', predicate = '']: (
    | string
    | undefined
  )[] = match

  const properties = Array.from(
    requireBody.matchAll(PROPERTY_SPEC_PATTERN),
    (propertyMatch) => propertyMatch[2] ?? '',
  )

  const upper = predicate.toUpperCase()

  let kind: GraphTypeConstraintKind = 'TYPE'

  if (upper.includes('UNIQUE')) {
    kind = 'UNIQUE'
  } else if (upper.includes('KEY')) {
    kind = 'KEY'
  } else if (upper.includes('NOT NULL')) {
    kind = 'EXISTS'
  }

  return {
    name,
    labelOrType: relationshipType ?? nodeLabel,
    relationship: relationshipType !== undefined,
    properties,
    kind,
    ...(kind === 'TYPE' && { type: predicate.replace(/^\s*IS\s*::\s*/i, '').trim() }),
  }
}

/**
Parse the canonical `specification` string `SHOW CURRENT GRAPH TYPE`
returns into the structural definition (NTS-550) — the same shapes the
statement builders render, so drift comparison is structural on both
sides. Accepts both the multi-line canonical form and a full `ALTER
CURRENT GRAPH TYPE SET` statement (single-line, comma-separated). Throws
on fragments it cannot parse (the canonical form is deterministic — a
failure is a library bug and should be loud).
*/
export function parseGraphTypeSpecification(specification: string): GraphTypeDefinition {
  const body = specification
    .trim()
    .replace(/^ALTER\s+CURRENT\s+GRAPH\s+TYPE\s+SET\s*/i, '')
    .trim()

  if (body === '{}' || body === '{ }') {
    return { nodes: [], relationships: [], constraints: [] }
  }

  if (!body.startsWith('{') || !body.endsWith('}')) {
    throw new TypeError(`Cannot parse graph type specification: "${specification.trim()}"`)
  }

  // Inside the outer braces; the loop tracks only nested structure
  const inner = body.slice(1, -1)

  const nodes: GraphTypeNodeDefinition[] = []
  const relationships: GraphTypeRelationshipDefinition[] = []
  const constraints: GraphTypeConstraintDefinition[] = []

  // Top-level (depth-0) comma split — property maps and LIST<...> types
  // carry commas at depth 1
  let depth = 0
  let current = ''

  const flush = (): void => {
    const fragment = current.trim()

    current = ''

    if (fragment === '') {
      return
    }

    let match = NODE_SPEC_PATTERN.exec(fragment)

    if (match !== null) {
      // 1 = optional binding variable, 2 = label, 3 = implied labels,
      // 4 = property map body — capture groups are `string | undefined`
      // at runtime
      const groups: (string | undefined)[] = match
      const properties = parseSpecProperties(groups[4] ?? '')
      const implied = parseSpecImplied(groups[3])

      nodes.push({
        label: groups[2] ?? '',
        ...(implied !== undefined && { implies: implied }),
        ...(properties.length > 0 && { properties }),
      })

      return
    }

    match = RELATIONSHIP_SPEC_PATTERN.exec(fragment)

    if (match !== null) {
      // 1 = source label, 2 = type, 3 = property map body, 4 = target
      // label — capture groups are `string | undefined` at runtime
      const [, source, type = '', propertyBody = '', target]: (string | undefined)[] = match
      const properties = parseSpecProperties(propertyBody)

      relationships.push({
        type,
        ...(source !== undefined && { source }),
        ...(target !== undefined && { target }),
        ...(properties.length > 0 && { properties }),
      })

      return
    }

    match = CONSTRAINT_SPEC_PATTERN.exec(fragment)

    if (match !== null) {
      constraints.push(parseSpecConstraint(match))

      return
    }

    throw new TypeError(`Cannot parse graph type specification fragment: "${fragment}"`)
  }

  for (const character of inner) {
    if ('{[('.includes(character)) {
      depth += 1
    } else if ('}])'.includes(character)) {
      depth -= 1
    }

    if (character === ',' && depth === 0) {
      flush()

      continue
    }

    current += character
  }

  flush()

  return { nodes, relationships, constraints }
}

/**
The installed graph type's canonical specification string, or undefined
when no graph type is installed (`'{}'` in server output). Backend errors
(the command needs Cypher 25 / Neo4j 2026.02+ Enterprise) propagate to the
caller — drift probing catches them and omits the family.
*/
export async function currentGraphType(
  connection: ConnectionProvider,
): Promise<string | undefined> {
  const output = await connection.run('SHOW CURRENT GRAPH TYPE', {}, 'READ')

  const specification = output.records[0]?.get('specification')

  return typeof specification === 'string' && specification.trim() !== '{}'
    ? specification
    : undefined
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
`ALTER CURRENT GRAPH TYPE ADD { ... }` — NTS-551: add new element types and
constraint items to the existing graph type. Only additions are valid: an
ADD cannot modify an existing element type, and independent constraints
cannot be added to labels/types that already serve as identifying ones —
server-side rejections surface in the SchemaResult error.
*/
export function graphTypeAddStatement(definition: GraphTypeDefinition): string {
  const statements = [...elements(definition), ...constraintItems(definition)]

  if (statements.length === 0) {
    throw new TypeError(
      'Cannot extend a graph type: no node or relationship element types or constraints derived from the registered models',
    )
  }

  return `ALTER CURRENT GRAPH TYPE ADD {${statements.join(', ')}}`
}

/**
`ALTER CURRENT GRAPH TYPE ALTER { ... }` — NTS-551: replace the definition
of existing element types (it redefines them to exactly what is given —
partially defining an element type does not leave the omitted parts
unchanged). Key/uniqueness constraints cannot be included: they cannot be
altered server-side and remain unchanged instead, so definitions carrying
them are rejected rather than silently redefined without them.
*/
export function graphTypeAlterStatement(definition: GraphTypeDefinition): string {
  if ((definition.constraints ?? []).length > 0) {
    throw new TypeError(
      'ALTER cannot include constraint items — key/uniqueness constraints remain unchanged',
    )
  }

  const uniqueBearers = definition.nodes
    .map(
      (node) =>
        [
          node.label,
          node.properties
            ?.filter((property) => property.unique === true)
            .map((property) => property.name) ?? [],
        ] as const,
    )
    .filter(([, names]) => names.length > 0)

  if (uniqueBearers.length > 0) {
    throw new TypeError(
      `ALTER cannot include key/uniqueness constraints — remove them from the element types: ${uniqueBearers.map(([label, names]) => `${label}(${names.join(', ')})`).join(', ')}`,
    )
  }

  const statements = elements(definition)

  if (statements.length === 0) {
    throw new TypeError('Cannot alter a graph type: no node or relationship element types given')
  }

  return `ALTER CURRENT GRAPH TYPE ALTER {${statements.join(', ')}}`
}

/**
Derives a graph type and strips its constraint items + any uniqueness
flags — the key/uniqueness shape ALTER leaves unchanged (NTS-551)
*/
export function deriveGraphTypeElementsOnly(): GraphTypeDefinition {
  const derived = deriveGraphType()

  const stripUniqueness = (
    properties: GraphTypePropertyDefinition[] | undefined,
  ): GraphTypePropertyDefinition[] | undefined => {
    if (properties === undefined) {
      return undefined
    }

    const kept: GraphTypePropertyDefinition[] = []

    for (const property of properties) {
      if (property.unique !== true) {
        kept.push(property)
      }
    }

    return kept
  }

  const nodes = derived.nodes.map((node) => {
    const properties = stripUniqueness(node.properties)

    return { ...node, ...(properties !== undefined && { properties }) }
  })

  const relationships = derived.relationships?.map((relationship) => {
    const properties = stripUniqueness(relationship.properties)

    return { ...relationship, ...(properties !== undefined && { properties }) }
  })

  return {
    nodes,
    ...(relationships !== undefined && { relationships }),
  }
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

function failedResult(action: ConstraintAction, statement: string, error: unknown): SchemaResult {
  return {
    ...graphTypeResult(action, statement),
    error: error instanceof Error ? error : new Error(String(error)),
  }
}

function graphTypeUnsupported(action: ConstraintAction): SchemaResult {
  const verbs: Record<ConstraintAction, string> = {
    [ConstraintAction.CREATE]: 'SET',
    [ConstraintAction.DROP]: 'DROP',
    [ConstraintAction.ADD]: 'ADD',
    [ConstraintAction.ALTER]: 'ALTER',
  }

  return {
    ...graphTypeResult(action, `-- ALTER CURRENT GRAPH TYPE ${verbs[action]} { ... }`),
    error: new Error(
      'Graph types are Enterprise Edition only (Neo4j 2026.02+): enable the enterprise flag ' +
        '(new Neode(connection, true) / NEO4J_ENTERPRISE=true / setEnterprise(true)) before installing',
    ),
  }
}

/**
Options for installing the model-derived graph type (NTS-578)
*/
export interface GraphTypeCreateOptions {
  /**
  Extra named constraint items (NTS-549)
  */
  constraints?: GraphTypeConstraintDefinition[]
  /**
  Opt into `ALTER CURRENT GRAPH TYPE SET`, replacing the server's whole
  graph type (default: false — only missing objects are added)
  */
  replace?: boolean
  /**
  With `replace`: proceed even when the replacement drops installed
  objects the registered models do not declare
  */
  canDropUndeclared?: boolean
}

/**
Applies the model-derived graph type with one ADD/SET/DROP statement, following
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

  private async replace(
    declared: GraphTypeDefinition,
    canDropUndeclared: boolean,
  ): Promise<SchemaResult[]> {
    const statement = graphTypeSetStatement(declared)

    if (!canDropUndeclared) {
      let specification: string | undefined

      try {
        specification = await currentGraphType(this.connection)
      } catch (error) {
        return [failedResult(ConstraintAction.CREATE, statement, error)]
      }

      const stale =
        specification === undefined
          ? []
          : graphTypeDriftGroup(parseGraphTypeSpecification(specification), declared, specification)
              .stale

      if (stale.length > 0) {
        const names = stale.map((entry) => entry.name || entry.labelsOrTypes.join(',')).join(', ')

        return [
          failedResult(
            ConstraintAction.CREATE,
            statement,
            new Error(
              `Refusing to replace the graph type — ALTER CURRENT GRAPH TYPE SET would drop ` +
                `${String(stale.length)} installed object(s) no registered model declares: ${names}. ` +
                'They may belong to another application sharing this database. Register the models that ' +
                'declare them, use installGraphType() without `replace` to only add what is missing, or ' +
                'pass `canDropUndeclared: true` to drop them deliberately.',
            ),
          ),
        ]
      }
    }

    return this.run(ConstraintAction.CREATE, statement)
  }

  /**
  Install the model-derived graph type (NTS-578). Non-destructive by
  default: probes the installed graph type and `ADD`s only the element
  types and constraint items that are missing, leaving everything else on
  a shared database alone; differing definitions are reported as failed
  results (fix: `alter()` or `replace: true`), never rewritten.

  `replace: true` opts into `ALTER CURRENT GRAPH TYPE SET`, which replaces
  the server's WHOLE graph type. It is refused when that would drop
  element types or constraints the registered models do not declare,
  unless `canDropUndeclared: true` is passed too.
  */
  async create(options: GraphTypeCreateOptions = {}): Promise<SchemaResult[]> {
    if (!this.enterprise) {
      return [graphTypeUnsupported(ConstraintAction.CREATE)]
    }

    const declared = deriveGraphType(
      options.constraints === undefined ? {} : { constraints: options.constraints },
    )

    if (options.replace === true) {
      return this.replace(declared, options.canDropUndeclared === true)
    }

    let specification: string | undefined

    try {
      specification = await currentGraphType(this.connection)
    } catch (error) {
      return [failedResult(ConstraintAction.CREATE, graphTypeAddStatement(declared), error)]
    }

    const drift = graphTypeDriftGroup(
      specification === undefined
        ? { nodes: [], relationships: [] }
        : parseGraphTypeSpecification(specification),
      declared,
      specification,
    )

    const missing = {
      nodes: declared.nodes.filter((node) =>
        drift.missing.some((entry) => entry.name === node.label),
      ),
      relationships: (declared.relationships ?? []).filter((relationship) =>
        drift.missing.some((entry) => entry.name === relationship.type),
      ),
      constraints: (declared.constraints ?? []).filter((constraint) =>
        drift.missing.some(
          (entry) => entry.name === (constraint.name ?? graphTypeConstraintName(constraint)),
        ),
      ),
    }

    const results: SchemaResult[] = []

    if (missing.nodes.length + missing.relationships.length + missing.constraints.length > 0) {
      results.push(...(await this.run(ConstraintAction.CREATE, graphTypeAddStatement(missing))))
    } else if (drift.mismatched.length === 0) {
      results.push({
        ...graphTypeResult(ConstraintAction.CREATE, '-- graph type already up to date'),
        success: true,
      })
    }

    for (const entry of drift.mismatched) {
      results.push({
        ...graphTypeResult(ConstraintAction.ALTER, entry.createStatement ?? ''),
        label: entry.name,
        error: new Error(
          `Installed graph type element "${entry.name}" differs from the registered models and ` +
            'was left unchanged (installGraphType() does not rewrite existing definitions). ' +
            'Redefine it with alterGraphType(), or pass `replace: true` to replace the whole graph type.',
        ),
      })
    }

    return results
  }

  async drop(
    options: { constraints?: GraphTypeConstraintDefinition[] } = {},
  ): Promise<SchemaResult[]> {
    return this.enterprise
      ? this.run(ConstraintAction.DROP, graphTypeDropStatement(deriveGraphType(options)))
      : [graphTypeUnsupported(ConstraintAction.DROP)]
  }

  /**
  NTS-551 — `ALTER CURRENT GRAPH TYPE ADD`: add the derived (or given)
  element types and constraint items to the existing graph type
  */
  async extend(definition: GraphTypeDefinition = deriveGraphType()): Promise<SchemaResult[]> {
    return this.enterprise
      ? this.run(ConstraintAction.ADD, graphTypeAddStatement(definition))
      : [graphTypeUnsupported(ConstraintAction.ADD)]
  }

  /**
  NTS-551 — `ALTER CURRENT GRAPH TYPE ALTER`: redefine the given (or
  derived, constraint-stripped) element types. Key/uniqueness constraints
  are not part of an ALTER and remain unchanged server-side.
  */
  async alter(
    definition: GraphTypeDefinition = deriveGraphTypeElementsOnly(),
  ): Promise<SchemaResult[]> {
    return this.enterprise
      ? this.run(ConstraintAction.ALTER, graphTypeAlterStatement(definition))
      : [graphTypeUnsupported(ConstraintAction.ALTER)]
  }
}

/**
One drifted schema object: what it is, where it lives, and the exact
statement(s) that would resolve the drift (NTS-450)
*/
export interface SchemaDriftEntry {
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

const hasSameValues = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value) => right.includes(value))

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
export function graphTypeDriftGroup(
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
