import type { DefaultValue } from './property-schema.js'

/**
neode-compatible property type names for map-based schema definitions.

Unknown names fall back to `any` (neode treats them as Joi hints; the OGM
has no validation pass so they carry no behaviour).
*/
export type PropertyTypeName =
  | 'any'
  | 'string'
  | 'number'
  | 'int'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'uuid'
  | 'date'
  | 'time'
  | 'datetime'
  | 'localtime'
  | 'localdatetime'
  | 'point'
  | 'duration'

/**
Vector index declaration for a property (NTS-447): installing the schema
creates a Neo4j vector index over the property (dropped by `dropSchema()`),
and `knn()` searches it. `dimensions` must match the embedding model;
`similarityFunction` defaults to 'cosine'.
*/
export interface VectorConfig {
  /**
  Number of dimensions of the stored vectors — must match the embedding model
  */
  dimensions: number
  similarityFunction?: 'cosine' | 'euclidean'
  /**
  Embedding sugar (NTS-449): the property whose value the vector is
  computed from — e.g. `from: 'plot'` embeds the `plot` property.
  */
  from?: string
  /**
  Embedding sugar (NTS-449): the embedding function the user supplies
  (the library stays dependency-free) — called with the source property's
  value whenever that source property is being written and the vector
  property itself is not explicitly provided in the same payload
  (an explicit vector value always wins). Failures surface as a
  NeodeError naming the model and property.
  */
  provider?: (text: string) => Promise<number[]>
}

/**
Property value transforms (NTS-449): user-supplied value mappers applied
on the write and read paths. `in` converts a user value into its stored
form before validation on every write path (create / update / merge /
bulk); `out` converts the stored form back at hydration. Both may be
async on the write path — `out` must be synchronous, hydration is
synchronous. Failures surface as a NeodeError naming the model and
property.
*/
export interface TransformConfig {
  /**
  value -> stored form, applied before validation on every write path
  (create / update / merge / bulk writes). May be async.
  */
  in?: (value: unknown) => unknown
  /**
  stored form -> value, applied at hydration on read. Must be
  synchronous — hydration is a synchronous pass.
  */
  out?: (value: unknown) => unknown
}

/**
Full form property definition, mirroring neode's schema object options.
*/
export interface PropertyDefinition {
  type: PropertyTypeName
  /**
  Free-text explanation of the property for LLM-agent-facing ontology
  emission (NTS-445): surfaced by `ontology()` / `ontologyMarkdown()`.
  */
  description?: string
  array?: boolean
  default?: DefaultValue
  primary?: boolean
  /**
  Include in the model's full-text search index (NTS-436).
  */
  fulltext?: boolean
  /**
  boolean: single-property unique constraint.
  string[]: composite unique covering exactly the listed properties
  (NTS-140) — declared on one property, the array is the full composite.
  */
  unique?: boolean | string[]
  onCreateSet?: boolean
  onMatchSet?: boolean
  alwaysSet?: boolean
  required?: boolean
  hidden?: boolean
  protected?: boolean
  readonly?: boolean
  /**
  boolean: single-property index.
  string[]: composite index covering exactly the listed properties (NTS-140).
  */
  index?: boolean | string[]
  exists?: boolean
  /**
  Opt in to a property-type constraint generated from the declared type (NTS-141): `REQUIRE n.prop IS :: STRING`.
  */
  typed?: boolean
  /**
  Declare a vector index over the property (NTS-447): created by
  `installSchema()` with the deterministic `vectorIndexName()` naming and
  dropped by `dropSchema()`.
  */
  vector?: VectorConfig
  /**
  Property value transforms (NTS-449): `in` converts the user value into
  its stored form before validation on every write path (create / update
  / merge / bulk writes), `out` converts the stored form back at
  hydration on read. See TransformConfig.
  */
  transform?: TransformConfig
  /**
  Read-side fallbacks applied at hydration when the stored/projected
  value is null or absent (NTS-139, the Zod `.catch()` analogue): a
  literal, or sibling property names whose first non-null value wins.
  */
  coalesce?: string | string[]
  /**
  Per-property fake data generator (NTS-444): user-supplied, no faker
  dependency. Invoked by factory seeding (and the create path) when
  neither an explicit value nor `default` applies — precedence on
  create is explicit value > `default` > `fake`, and generated values
  are validated like any other write.
  */
  fake?: () => unknown
}

/**
Relationship definition, mirroring neode's relationship schema entries.

`type` uses neode's singular/plural spellings ('relationship'/'node' for
one, 'relationships'/'nodes' for many).
*/
export interface RelationshipDefinition {
  type: 'relationship' | 'relationships' | 'node' | 'nodes'
  /**
  Free-text explanation of the relationship for LLM-agent-facing ontology
  emission (NTS-445): surfaced by `ontology()` / `ontologyMarkdown()`.
  */
  description?: string
  /**
  Neo4j relationship type, e.g. 'KNOWS'
  */
  relationship: string
  /**
  'in' | 'out' | 'both' (case-insensitive, invalid falls back to both)
  */
  direction: string
  /**
  Name of the model this relationship points at
  */
  target: string
  /**
  shortcut: edge properties are parsed but not wired yet — needs a generated relationship entity; add when edge-property saves are needed
  */
  properties?: Record<string, PropertyTypeName | PropertyDefinition>
  eager?: boolean
}

/**
Read-model projection definitions (NTS-135/136/137/138) — the map-based
API for @RelatedOne / @RelatedMany / @RelationshipCount /
@RelationshipExists / @LabelPresent / @Expression / @Computed.
*/

/**
@RelatedOne: `fields` omitted = full-entity eager loading
*/
export interface RelatedOneDefinition {
  type: 'relatedOne'
  relationship: string
  direction?: string
  target?: string
  fields?: string[]
}

/**
@RelatedMany: a single-field subset projects a scalar array
*/
export interface RelatedManyDefinition {
  type: 'relatedMany'
  relationship: string
  direction?: string
  target?: string
  fields?: string[]
}

/**
@RelationshipCount: multi-type via pipe ('A|B'); `where` uses `node` for the target node
*/
export interface RelationshipCountDefinition {
  type: 'relationshipCount'
  relationship: string
  direction?: string
  target?: string
  where?: string
  minHops?: number
  maxHops?: number
}

/**
@RelationshipExists: `EXISTS { }` boolean
*/
export interface RelationshipExistsDefinition {
  type: 'relationshipExists'
  relationship: string
  direction?: string
  where?: string
}

/**
@LabelPresent: true when the node carries the label
*/
export interface LabelPresentDefinition {
  type: 'labelPresent'
  label: string
}

/**
@Expression: raw Cypher projected into the read query (root node is `this`)
*/
export interface ExpressionDefinition {
  type: 'expression'
  expression: string
}

/**
@Computed: derived in TypeScript after hydration
*/
export interface ComputedDefinition {
  type: 'computed'
  compute: (entity: unknown) => unknown
}

export type ProjectionDefinition =
  | RelatedOneDefinition
  | RelatedManyDefinition
  | RelationshipCountDefinition
  | RelationshipExistsDefinition
  | LabelPresentDefinition
  | ExpressionDefinition
  | ComputedDefinition

export type SchemaDefinitionEntry =
  | PropertyTypeName
  | PropertyDefinition
  | RelationshipDefinition
  | ProjectionDefinition

/**
Map-based schema definition for a model (neode parity).

Every key except `labels` defines a property or relationship. Property
values may be shorthand type names (`age: 'number'`) or full definitions.
*/
export interface SchemaDefinition {
  labels?: string[]
  /**
  Free-text explanation of the model for LLM-agent-facing ontology
  emission (NTS-445): surfaced by `ontology()` / `ontologyMarkdown()`.
  */
  description?: string
  // The `string` arm admits the entity-level `description` key (NTS-445);
  // it subsumes PropertyTypeName, hence the redundancy suppression
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- string subsumes PropertyTypeName by design, so `description?: string` can coexist with the index signature
  [key: string]: SchemaDefinitionEntry | string[] | string | undefined
}
