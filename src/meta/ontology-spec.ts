import type { RelationshipCardinality } from './relationship-property-schema.js'
import type {
  PropertyDefinition,
  PropertyTypeName,
  RelationshipDefinition,
  SchemaDefinition,
} from './schema-definition.interface.js'

/**
Map a Neo4j Ontology Graph Specification document (v1.1) to neode map schemas
(NTS-683).

The spec (https://neo4j.com/docs/ontology-graph-spec/) is Neo4j's official,
versioned YAML/JSON format for graph models. Parsing and validation stay with
the spec's own SDK — decode a document with `@neo4j/ontology-graph-spec`
(a devDependency used in tests only; neode's runtime never imports it), then
hand the decoded model to this mapper through the SDK's plain-JS bridge:

    import { GraphSpec, GraphModelEditor } from '@neo4j/ontology-graph-spec'

    const model = GraphSpec.Json.decodeFromString(document) // or GraphSpec.Yaml
    const schemas = ontologySpecToSchemas(GraphModelEditor.plain(model))

    for (const [name, schema] of Object.entries(schemas)) {
      defineModel(name, schema)
    }

`GraphModelEditor.plain()` is the SDK's documented bridge from the decoded
`GraphModel` to its plain-JS `GraphModelJs` shape — typed here structurally
(`OntologySpecModel`), so this module imports nothing from the SDK. The
output registers through `defineModel()` and composes with `withDirectory()`
as-is; CLI ingestion is out of scope (NTS-683).

Mapping table (spec field → neode field):

| Spec field                              | neode field                                   |
|-----------------------------------------|-----------------------------------------------|
| `nodes[key]`                            | one `SchemaDefinition`, keyed by the node id  |
| `nodes[key].labels.identifier`          | `labels[0]` — the model's identity label      |
| `nodes[key].labels.implied`             | appended to `labels`                          |
| `nodes[key].description`                | `description`                                 |
| `properties[name].type`                 | `type` (table below); `LIST<X>` adds `array: true` |
| `properties[name].description`          | `description`                                 |
| `properties[name].must_exist`           | `required`                                    |
| `properties[name].unique`               | `unique`                                      |
| `properties[name].key`                  | `unique` + `required` (node key = unique + exists) |
| `constraints[type=UNIQUE]`              | `unique` on every covered property            |
| `constraints[type=EXISTS]`              | `required` on every covered property          |
| `constraints[type=KEY]`                 | `unique` + `required` on every covered property |
| `constraints[type=PROPERTY_TYPE]`       | `typed` (`REQUIRE n.prop IS :: T`)            |
| `extensions.indexes[type=RANGE]`        | `index` — `true` for one property, the composite `string[]` otherwise |
| `extensions.indexes[type=FULLTEXT]`     | `fulltext` on every covered property          |
| `relationships[key]`                    | a relationship entry on BOTH endpoint models — `direction: 'out'` on the from-model, `'in'` on the to-model |
| `relationships[key].type`               | the entry key and `relationship`              |
| `relationships[key].from/to` counts     | `max_count: 1` → `'relationship'` type (`'zeroOrOne'` when `min_count: 0`), otherwise `'relationships'` |
| `relationships[key].properties[name]`   | entry `properties` (type / array / description) |

Dropped, with reasons:

- `aliases` (node / property / relationship) — alternative names, not graph structure.
- `nodes[key].labels.optional` — conditionally-present labels; neode's `labels` write and match every declared label.
- `reference`, `properties[name].pattern`, `properties[name].dimension` — spec-side metadata with no neode field.
- `properties[name].oneOf` — declare neode's `valid` rule by hand where the vocabulary matters.
- `extensions` (`custom`, `display`, `data_source_tables`, `data_source_mappings`) — tooling metadata, not model structure.
- `extensions.indexes[TEXT / POINT / VECTOR / LOOKUP]` — neode's map API declares range indexes, model full-text membership and vector-with-config only; TEXT/POINT have no map declaration, VECTOR needs the embedding model's dimensions, LOOKUP is built-in.
- relationship `constraints` — neode installs constraints on node labels only.
- a relationship endpoint naming no node of the model — that end's entry has nothing to anchor to.
- a spec property named `labels`, `description` or `filters` — neode's map schema reserves those keys for
  the metamodel (a property under a reserved name cannot be expressed; rename it by hand after mapping).

Spec type → neode type: `STRING`→`string`, `BOOLEAN`→`boolean`, `INTEGER`/`INTEGER8/16/32`→`integer`,
`FLOAT`/`FLOAT32`→`float`, `DATE`→`date`, `ZONED DATETIME`→`datetime`, `LOCAL DATETIME`→`localdatetime`,
`ZONED TIME`→`time`, `LOCAL TIME`→`localtime`, `DURATION`→`duration`, `POINT`→`point`, `UUID`→`uuid`,
`ANY`→`any`, `LIST<X>`→`X` + `array: true`, `VECTOR<FLOAT*>`/`VECTOR FLOAT*`→`float` + `array: true`,
`VECTOR<INTEGER*>`/`VECTOR INTEGER*`→`integer` + `array: true`, anything else→`any`.
*/

/**
One property of a spec node or relationship, as the SDK's plain-JS view
carries it (`PropertyJs`). Nullable everywhere: the decoded longhand form
leaves the boolean flags null and reports them through `constraints`.
*/
export interface OntologySpecProperty {
  type: string
  description?: string | null
  mustExist?: boolean | null
  unique?: boolean | null
  key?: boolean | null
  oneOf?: readonly string[] | null
  dimension?: number | null
}

/**
One spec constraint (`NodeConstraintJs` / `RelationshipConstraintJs`).
*/
export interface OntologySpecConstraint {
  type: string
  properties: readonly string[]
  name?: string | null
}

/**
One spec index (`NodeIndexJs` / `RelationshipIndexJs`).
*/
export interface OntologySpecIndex {
  type: string
  properties: readonly string[]
  labels?: readonly string[] | null
  name?: string | null
}

/**
The labels of a spec node (`LabelsJs`).
*/
export interface OntologySpecLabels {
  identifier?: string | null
  implied?: readonly string[] | null
  optional?: readonly string[] | null
}

/**
One spec node (`NodeJs`), keyed by its id in `OntologySpecModel.nodes`.
*/
export interface OntologySpecNode {
  labels?: OntologySpecLabels | null
  properties?: Record<string, OntologySpecProperty> | null
  constraints?: Record<string, OntologySpecConstraint> | null
  extensions?: { indexes?: Record<string, OntologySpecIndex> | null } | null
  description?: string | null
  aliases?: readonly string[] | null
}

/**
One endpoint of a spec relationship (`RelationshipTargetJs`).
*/
export interface OntologySpecRelationshipTarget {
  node?: string | null
  label?: string | null
  count?: number | null
  minCount?: number | null
  maxCount?: number | null
}

/**
One spec relationship (`RelationshipJs`), keyed by its id in
`OntologySpecModel.relationships`.
*/
export interface OntologySpecRelationship {
  type: string
  from?: OntologySpecRelationshipTarget | null
  to?: OntologySpecRelationshipTarget | null
  properties?: Record<string, OntologySpecProperty> | null
  description?: string | null
}

/**
The plain-JS view of a decoded spec model (`GraphModelJs`, structurally
typed — this module never imports the SDK).
*/
export interface OntologySpecModel {
  name?: string | null
  description?: string | null
  nodes?: Record<string, OntologySpecNode> | null
  relationships?: Record<string, OntologySpecRelationship> | null
}

/**
Spec wire type name → neode property type. Names the spec's JSON Schema
spells verbatim — spaces included ('ZONED DATETIME'), lists in angle
brackets, vectors in a space form.
*/
const PROPERTY_TYPE_MAP: Record<string, PropertyTypeName> = {
  ANY: 'any',
  BOOLEAN: 'boolean',
  DATE: 'date',
  DURATION: 'duration',
  FLOAT32: 'float',
  FLOAT: 'float',
  INTEGER8: 'integer',
  INTEGER16: 'integer',
  INTEGER32: 'integer',
  INTEGER: 'integer',
  'LOCAL DATETIME': 'localdatetime',
  'LOCAL TIME': 'localtime',
  POINT: 'point',
  STRING: 'string',
  UUID: 'uuid',
  'ZONED DATETIME': 'datetime',
  'ZONED TIME': 'time',
}

const VECTOR_FLOAT_TYPES = new Set([
  'VECTOR<FLOAT>',
  'VECTOR<FLOAT32>',
  'VECTOR FLOAT',
  'VECTOR FLOAT32',
])

const VECTOR_INTEGER_TYPES = new Set([
  'VECTOR<INTEGER>',
  'VECTOR<INTEGER8>',
  'VECTOR<INTEGER16>',
  'VECTOR<INTEGER32>',
  'VECTOR INTEGER',
  'VECTOR INTEGER8',
  'VECTOR INTEGER16',
  'VECTOR INTEGER32',
])

/**
Constraint type → the property flags it contributes (KEY is Neo4j's
unique + exists node key).
*/
const CONSTRAINT_FLAGS: Record<string, { unique?: boolean; required?: boolean; typed?: boolean }> =
  {
    UNIQUE: { unique: true },
    EXISTS: { required: true },
    KEY: { unique: true, required: true },
    PROPERTY_TYPE: { typed: true },
  }

/**
Index type → the property flag it contributes. Only RANGE and FULLTEXT have
neode map-API counterparts (see the dropped list in the header).
*/
const INDEX_FLAGS: Record<string, { index?: boolean; fulltext?: boolean }> = {
  RANGE: { index: true },
  FULLTEXT: { fulltext: true },
}

interface TypeMapping {
  type: PropertyTypeName
  array?: boolean
}

function mapSpecType(spec: string): TypeMapping {
  if (spec.startsWith('LIST<') && spec.endsWith('>')) {
    return { ...mapSpecType(spec.slice(5, -1)), array: true }
  }

  // Vectors: the wire spells them with angle brackets, the SDK's JS types
  // with spaces — accept both. They are numeric lists to neode.
  if (VECTOR_FLOAT_TYPES.has(spec)) {
    return { type: 'float', array: true }
  }

  if (VECTOR_INTEGER_TYPES.has(spec)) {
    return { type: 'integer', array: true }
  }

  return { type: PROPERTY_TYPE_MAP[spec] ?? 'any' }
}

/**
Per-property facts gathered from the node's constraints and inline flags —
the decoded (longhand) form reports must_exist/unique/key through
`constraints`, a hand-written longhand document through the property's own
flags; the mapper honours either.
*/
interface PropertyFacts {
  unique: boolean
  required: boolean
  typed: boolean
  index: boolean | string[]
  fulltext: boolean
}

const NO_FACTS: PropertyFacts = {
  unique: false,
  required: false,
  typed: false,
  index: false,
  fulltext: false,
}

/**
Free text with the spec's empty-string absence convention folded to undefined
*/
function text(value: string | null | undefined): string | undefined {
  return value === null || value === undefined || value === '' ? undefined : value
}

function mapProperty(spec: OntologySpecProperty, facts: PropertyFacts): PropertyDefinition {
  const mapping = mapSpecType(spec.type)
  const definition: PropertyDefinition = { type: mapping.type }
  const description = text(spec.description)

  if (mapping.array === true) {
    definition.array = true
  }

  if (description !== undefined) {
    definition.description = description
  }

  if (facts.unique || spec.unique === true || spec.key === true) {
    definition.unique = true
  }

  if (facts.required || spec.mustExist === true || spec.key === true) {
    definition.required = true
  }

  if (facts.typed) {
    definition.typed = true
  }

  if (facts.index !== false) {
    definition.index = facts.index
  }

  if (facts.fulltext) {
    definition.fulltext = true
  }

  return definition
}

function mapNode(key: string, node: OntologySpecNode): SchemaDefinition {
  const schema: SchemaDefinition = {}
  const identifier = text(node.labels?.identifier) ?? key

  // Identity label first, then the labels implied by it — neode's `labels`
  // are written and matched in full
  const labels = [identifier, ...(node.labels?.implied ?? [])].filter(
    (label, index, all) => label !== '' && all.indexOf(label) === index,
  )

  if (labels.length > 0) {
    schema.labels = labels
  }

  const description = text(node.description)

  if (description !== undefined) {
    schema.description = description
  }

  // Constraint facts per property name (longhand constraint form)
  const facts = new Map<string, PropertyFacts>()

  const factsFor = (name: string): PropertyFacts => {
    const existing = facts.get(name)

    if (existing !== undefined) {
      return existing
    }

    const fresh = { ...NO_FACTS }
    facts.set(name, fresh)

    return fresh
  }

  const constraints = Object.values(node.constraints ?? {})

  for (const constraint of constraints) {
    const flags = CONSTRAINT_FLAGS[constraint.type]

    if (flags === undefined) {
      continue
    }

    for (const name of constraint.properties) {
      Object.assign(factsFor(name), flags)
    }
  }

  // Index facts (single-property → `true`, multi-property → the composite list)
  const indexes = Object.values(node.extensions?.indexes ?? {})

  for (const index of indexes) {
    const flags = INDEX_FLAGS[index.type]

    if (flags === undefined) {
      continue
    }

    if (flags.fulltext === true) {
      for (const name of index.properties) {
        factsFor(name).fulltext = true
      }
    } else {
      const first = index.properties[0]

      if (first !== undefined) {
        factsFor(first).index = index.properties.length > 1 ? [...index.properties] : true
      }
    }
  }

  const properties = Object.entries(node.properties ?? {})

  for (const [name, property] of properties) {
    schema[name] = mapProperty(property, facts.get(name) ?? NO_FACTS)
  }

  return schema
}

function cardinality(target: OntologySpecRelationshipTarget | null | undefined): {
  type: 'relationship' | 'relationships'
  cardinality?: RelationshipCardinality
} {
  if (target?.maxCount === 1) {
    return {
      type: 'relationship',
      cardinality: target.minCount === 0 ? 'zeroOrOne' : 'one',
    }
  }

  return { type: 'relationships' }
}

function mapRelationshipProperties(
  properties: Record<string, OntologySpecProperty> | null | undefined,
): Record<string, PropertyTypeName | PropertyDefinition> | undefined {
  const entries = Object.entries(properties ?? {})

  if (entries.length === 0) {
    return undefined
  }

  const mapped: Record<string, PropertyTypeName | PropertyDefinition> = {}

  // Edge constraints are dropped (neode installs constraints on node labels
  // only), so edge properties carry their type and description alone
  for (const [name, property] of entries) {
    const mapping = mapSpecType(property.type)
    const definition: PropertyDefinition = { type: mapping.type }
    const description = text(property.description)

    if (mapping.array === true) {
      definition.array = true
    }

    if (description !== undefined) {
      definition.description = description
    }

    mapped[name] = definition
  }

  return mapped
}

function addRelationshipEntry(
  schema: SchemaDefinition | undefined,
  relationshipType: string,
  target: string,
  direction: 'in' | 'out',
  endpoint: OntologySpecRelationshipTarget | null | undefined,
  description: string | undefined,
  properties: Record<string, PropertyTypeName | PropertyDefinition> | undefined,
): void {
  if (schema === undefined) {
    return
  }

  // Two relationships of the same type from the same node (to different
  // targets) would collide on the entry key — suffix the target
  const key =
    schema[relationshipType] === undefined ? relationshipType : `${relationshipType}_${target}`
  const counted = cardinality(endpoint)

  const entry: RelationshipDefinition = {
    type: counted.type,
    relationship: relationshipType,
    direction,
    target,
  }

  if (counted.cardinality !== undefined) {
    entry.cardinality = counted.cardinality
  }

  if (description !== undefined) {
    entry.description = description
  }

  if (properties !== undefined) {
    entry.properties = properties
  }

  schema[key] = entry
}

/**
Map a decoded Ontology Graph Spec model to neode map schemas, keyed by the
spec's node ids. See the module header for the full mapping table.
*/
export function ontologySpecToSchemas(model: OntologySpecModel): Record<string, SchemaDefinition> {
  const schemas: Record<string, SchemaDefinition> = {}
  const nodes = model.nodes ?? {}
  const relationships = model.relationships ?? {}

  for (const [key, node] of Object.entries(nodes)) {
    schemas[key] = mapNode(key, node)
  }

  for (const relationship of Object.values(relationships)) {
    const relationshipType = text(relationship.type)
    const from = text(relationship.from?.node) ?? text(relationship.from?.label)
    const to = text(relationship.to?.node) ?? text(relationship.to?.label)

    if (relationshipType === undefined || from === undefined || to === undefined) {
      continue
    }

    const description = text(relationship.description)
    const properties = mapRelationshipProperties(relationship.properties)

    addRelationshipEntry(
      schemas[from],
      relationshipType,
      to,
      'out',
      relationship.from,
      description,
      properties,
    )
    addRelationshipEntry(
      schemas[to],
      relationshipType,
      from,
      'in',
      relationship.to,
      description,
      properties,
    )
  }

  return schemas
}
