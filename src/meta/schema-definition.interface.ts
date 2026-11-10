import type { DefaultValue, TimestampFormat } from './property-schema.js'
import type { FilterDefinition } from './entity/entity-schema.js'
import type { RelationshipCardinality } from './relationship-property-schema.js'

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
  value whenever that source is written and the vector property itself is
  not explicitly provided in the same payload (an explicit vector value
  always wins). On tracked saves (dirty tracking) the recompute runs only
  when the source property is dirty — a clean source keeps its stored
  vector and costs no provider call. Failures surface as a NeodeError
  naming the model and property.
  */
  provider?: (text: string) => Promise<number[]>
}

/**
Stored derived property (NTS-569): the property's value is computed on the
write path from other properties and stored like a hand-set value — the
write-time counterpart of `@Computed` (read-time, never stored).
*/
export interface DerivedConfig {
  /**
  The source properties the derivation reads. A write that touches any
  source (explicit value, default or dirty key) recomputes the derived
  property, unless the derived property itself is explicitly provided in
  the same payload (an explicit value always wins).
  */
  from: string[]
  /**
  TypeScript-side derivation: called with the entity's property record
  (every declared value the write can see, dirty sources included) and its
  return value is stored. Exactly one of `compute` / `cypher` is required.
  Failures surface as a NeodeError naming the model and property.
  */
  compute?: (entity: Record<string, unknown>) => unknown
  /**
  Cypher-side derivation: a raw Cypher expression evaluated by the
  database inside the write statement, after the sources are written —
  `this` is the written node and its properties already carry the new
  values (e.g. `duration.between(this.orderDate, this.shippedDate).days`).
  Exactly one of `compute` / `cypher` is required.
  */
  cypher?: string
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
Validation rules accepted on a property definition (neode's Joi rule
names, ported in src/validation/rule-table.ts). Every non-metamodel key
of a map-schema property definition travels to the validator as a rule
(mergeProperty persists it via PropertySchema#setRules), so these are the
keys the published map API accepts alongside the structural options.

Rules are applied on top of the property's base type: a rule the base
type does not support throws at validation time (rule-table's
failUnsupported), and boolean rules must be exactly `true`.
*/
export interface ValidationRules {
  /**
  Minimum (number value or string length)
  */
  min?: number
  /**
  Maximum (number value or string length)
  */
  max?: number
  /**
  Exact string length
  */
  length?: number
  /**
  Maximum number of decimal places
  */
  precision?: number
  /**
  Value must be a multiple of this
  */
  multiple?: number
  positive?: true
  negative?: true
  port?: true
  integer?: true
  /**
  ISO 8601 date or datetime string
  */
  iso?: true
  isoDate?: true
  optional?: true
  forbidden?: true
  strip?: true
  /**
  Requires `max` — strings over the limit are truncated instead of failing
  */
  truncate?: true
  /**
  Case-insensitive matching for `valid` / `invalid` / `allow`
  */
  insensitive?: true
  creditCard?: true
  alphanum?: true
  token?: true
  hostname?: true
  lowercase?: true
  uppercase?: true
  truthy?: true
  falsy?: true
  email?: true
  ip?: true
  uri?: true
  base64?: true | { paddingRequired?: boolean }
  /**
  Unicode normalisation form, 'NFC' by default
  */
  normalize?: true | { form?: string }
  hex?: true | { prefix?: boolean; byteAligned?: boolean }
  regex?: RegExp | { pattern: RegExp; name?: string; invert?: boolean }
  replace?: { pattern: string | RegExp; replace?: string }
  /**
  Value must be before this boundary ('now' resolves at validation time)
  */
  before?: string | number | Date
  /**
  Value must be after this boundary ('now' resolves at validation time)
  */
  after?: string | number | Date
  guid?: true | { version?: 'uuidv4' }
  trim?: boolean
  /**
  Accepted values bypass every other check (Joi semantics)
  */
  allow?: unknown
  valid?: unknown
  invalid?: unknown
  /**
  Accepted for Joi parity — coercion never happens, so this is a no-op
  */
  strict?: boolean
  /**
  Accepted for Joi parity — '' is always treated as unset
  */
  empty?: boolean
}

/**
Full form property definition, mirroring neode's schema object options.
*/
export interface PropertyDefinition extends ValidationRules {
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
  /**
  Server-side timestamp (NTS-165): stamped with `datetime()` once on
  create — the map-API form of `@CreatedAt`.
  */
  createdAt?: boolean
  /**
  Server-side timestamp (NTS-165): stamped with `datetime()` on create and
  on every write — the map-API form of `@UpdatedAt`.
  */
  updatedAt?: boolean
  /**
  Stamp form for a server-side timestamp (NTS-612): 'iso-string' renders
  the stamp as `toString(datetime())` so the stored value compares
  lexically against client ISO strings; the default stores the temporal —
  the map-API form of the `@CreatedAt` / `@UpdatedAt` config option.
  */
  timestampFormat?: TimestampFormat
  /**
  Optimistic locking (NTS-158): the integer property every write keeps in
  sync — stamped 0 on create, incremented by 1 on every write addressed to
  the node, and checked with `WHERE n.version = $expected` when the
  instance carries the version it was hydrated with (a mismatch throws
  `OptimisticLockError`). The map-API form of `@Version`.
  */
  version?: boolean
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
  Stored derived property (NTS-569): computed on the write path from the
  `from` source properties and stored like a hand-set value. See
  DerivedConfig — exactly one of `compute` / `cypher`.
  */
  derived?: DerivedConfig
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
  The edge-property schema (NTS-628): the allowed edge properties and
  their types — runtime edge props on relate() / nested creates /
  updateEdgeProperties validate against it (unknown property or wrong
  type throws naming the key). Per-property defaults/transforms on edges
  are a follow-up.
  */
  properties?: Record<string, PropertyTypeName | PropertyDefinition>
  eager?: boolean
  /**
  Per-relationship cascade: deleting a node also deletes the nodes reached
  through this relationship, recursively (each level applies its own
  annotations). Unannotated relationships survive unless the delete call
  opts in with `{ cascade: true }`.
  */
  cascade?: boolean
  /**
  Write-time cardinality (NTS-161): 'one' / 'zeroOrOne' allow at most one
  edge from a node — a second relate() throws CardinalityViolationError;
  'many' is unrestricted. Undefined derives from the type: 'relationship'
  / 'node' declare one, 'relationships' / 'nodes' declare many.
  */
  cardinality?: RelationshipCardinality
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
  /**
  Named global filters (NTS-568) — the map-API form of `@Filter`: each
  applies to every standard read unless disabled per query with
  `withoutFilters`. Names must be unique per model and valid Cypher
  parameter names.
  */
  filters?: FilterDefinition[]
  // The `string` arm admits the entity-level `description` key (NTS-445);
  // it subsumes PropertyTypeName, hence the redundancy suppression
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- string subsumes PropertyTypeName by design, so `description?: string` can coexist with the index signature
  [key: string]: SchemaDefinitionEntry | string[] | string | FilterDefinition[] | undefined
}
