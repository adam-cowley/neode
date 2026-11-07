import type { Newable } from '../meta/newable.js'
import type { Direction } from '../query/index.js'
import type { VectorConfig, TransformConfig } from './schema-definition.interface.js'
import type { EntitySchema } from './entity/entity-schema.js'

export const PropertyType = {
  ANY: 0,
  INTERNAL_ID: 1,
  ALL_PROPERTIES: 2,
  UUID: 3,
  STRING: 4,
  INTEGER: 5,

  // Numbers
  FLOAT: 6,
  NUMBER: 7,

  BOOLEAN: 8,

  // Temporal
  DATE: 9,
  TIME: 10,
  DATETIME: 11,
  LOCALTIME: 12,
  LOCALDATETIME: 13,

  // Spatial
  POINT: 14,

  // Durations
  DURATION: 15,

  // Relationships
  ONE_TO_ONE: 16,
  ONE_TO_MANY: 17,

  // Read-model projections (NTS-135/136/137/138): composed into the RETURN
  // map projection of the read query — one Cypher query per read
  RELATED_ONE: 18,
  RELATED_MANY: 19,
  RELATIONSHIP_COUNT: 20,
  RELATIONSHIP_EXISTS: 21,
  LABEL_PRESENT: 22,
  COMPUTED: 23,
  EXPRESSION: 24,

  START_NODE: 25,
  END_NODE: 26,
  OTHER_NODE: 27,

  NODE: 28,
  RELATIONSHIP: 29,
} as const

export type PropertyType = (typeof PropertyType)[keyof typeof PropertyType]

/**
Property types that project read-model values: RELATED_ONE / RELATED_MANY
eager subsets, RELATIONSHIP_COUNT, RELATIONSHIP_EXISTS, LABEL_PRESENT and
EXPRESSION compose extra reads into the RETURN projection;
COMPUTED derives a value in TypeScript after hydration.
Any of these on a model means reads must go through the projection path.
*/
export const ProjectedPropertyTypes: PropertyType[] = [
  PropertyType.RELATED_ONE,
  PropertyType.RELATED_MANY,
  PropertyType.RELATIONSHIP_COUNT,
  PropertyType.RELATIONSHIP_EXISTS,
  PropertyType.LABEL_PRESENT,
  PropertyType.EXPRESSION,
  PropertyType.COMPUTED,
]

/**
Property types that map onto Neo4j temporal values
*/
export type DefaultValue = (model: object, schema: EntitySchema) => unknown

export class PropertySchema {
  private type: PropertyType = PropertyType.ANY
  private defaultValue!: DefaultValue

  private primaryKey = false
  private unique = false
  private array = false
  private required = false
  private hidden = false
  private protectedOption = false
  private readOnly = false
  private index = false
  private exists = false
  private onCreateSet = false
  private onMatchSet = false
  private alwaysSet = false
  private fulltext = false

  /**
  Free-text explanation emitted by the agent ontology (NTS-445)
  */
  private description: string | undefined

  private entity!: Newable

  /**
  neode validation rules (min, max, email, regex, …) beyond the metamodel flags
  */
  private rules: Record<string, unknown> = {}

  private readonly key: string

  // ---- Hydration + schema-sync config (NTS-139/140/141) ----

  /**
  Read-side fallbacks at hydration (NTS-139): a literal, or sibling property names (first non-null wins)
  */
  private coalesce: string | string[] | undefined

  /**
  Opt in to a property-type constraint generated from the declared type (NTS-141)
  */
  private typed = false

  /**
  Composite unique constraint properties (NTS-140): the full composite, declared on one property
  */
  private compositeUnique: string[] | undefined

  /**
  Composite index properties (NTS-140): the full composite, declared on one property
  */
  private compositeIndex: string[] | undefined

  /**
  Per-property fake data generator (NTS-444): user-supplied, no faker
  dependency. Invoked on the create path when neither an explicit value
  nor `default` applies (precedence: explicit > default > fake).
  */
  private fake: (() => unknown) | undefined

  /**
  Vector index declaration (NTS-447): installSchema()/dropSchema() turn it
  into a VectorIndexDefinition for the owning label
  */
  private vector: VectorConfig | undefined

  /**
  Property value transforms (NTS-449): `in` maps user values to their
  stored form before validation on writes, `out` maps the stored form
  back at hydration
  */
  private transform: TransformConfig | undefined

  // ---- Read-model projection configuration (NTS-135/136/137/138) ----

  /**
  @RelatedOne / @RelatedMany: relationship type, e.g. 'IN_COURSE' ('A|B' allowed)
  */
  private relationshipType: string | undefined

  /**
  @RelatedOne / @RelatedMany: field subset; undefined = full-entity eager loading
  */
  private fields: string[] | undefined

  /**
  @RelatedOne / @RelatedMany / @RelationshipCount / @RelationshipExists direction
  */
  private projectionDirection: Direction | undefined

  /**
  WHERE fragment inside COUNT { } / EXISTS { }; `node` is the target node
  */
  private where: string | undefined

  /**
  @RelationshipCount variable-length hop bounds
  */
  private minHops: number | undefined
  private maxHops: number | undefined

  /**
  @LabelPresent: the label tested for
  */
  private label: string | undefined

  /**
  @Expression: raw Cypher projected into the read query
  */
  private expression: string | undefined

  /**
  @Computed: derives the value in TypeScript after hydration
  */
  private compute: ((entity: unknown) => unknown) | undefined

  constructor(key: string) {
    this.key = key
  }

  getKey(): string {
    return this.key
  }

  setType(type: PropertyType): void {
    this.type = type
  }

  getType(): PropertyType {
    return this.type
  }

  setArray(isArray = true): void {
    this.array = isArray
  }

  isArray(): boolean {
    return this.array
  }

  setDefaultValue(value: DefaultValue): void {
    this.defaultValue = value
  }

  getDefaultValue(): DefaultValue {
    return this.defaultValue
  }

  setPrimaryKey(isPrimaryKey = true): void {
    this.primaryKey = isPrimaryKey
    this.unique = isPrimaryKey
  }

  isPrimaryKey(): boolean {
    return this.primaryKey
  }

  setUnique(isUnique = true): void {
    this.unique = isUnique
  }

  isUnique(): boolean {
    return this.unique
  }

  setRequired(isRequired = true): void {
    this.required = isRequired
  }

  isRequired(): boolean {
    return this.required
  }

  setHidden(isHidden = true): void {
    this.hidden = isHidden
  }

  isHidden(): boolean {
    return this.hidden
  }

  setProtected(isProtected = true): void {
    this.protectedOption = isProtected
  }

  isProtected(): boolean {
    return this.protectedOption
  }

  setReadonly(isReadonly = true): void {
    this.readOnly = isReadonly
  }

  isReadonly(): boolean {
    return this.readOnly
  }

  setIndex(isIndex = true): void {
    this.index = isIndex
  }

  isIndex(): boolean {
    return this.index
  }

  setExists(isExists = true): void {
    this.exists = isExists
  }

  isExists(): boolean {
    return this.exists
  }

  setCoalesce(coalesce: string | string[]): void {
    this.coalesce = coalesce
  }

  getCoalesce(): string | string[] | undefined {
    return this.coalesce
  }

  setTyped(isTyped = true): void {
    this.typed = isTyped
  }

  isTyped(): boolean {
    return this.typed
  }

  setCompositeUnique(properties: string[]): void {
    this.compositeUnique = properties
  }

  getCompositeUnique(): string[] | undefined {
    return this.compositeUnique
  }

  setCompositeIndex(properties: string[]): void {
    this.compositeIndex = properties
  }

  getCompositeIndex(): string[] | undefined {
    return this.compositeIndex
  }

  setFake(fake: () => unknown): void {
    this.fake = fake
  }

  getFake(): (() => unknown) | undefined {
    return this.fake
  }

  setVector(vector: VectorConfig): void {
    this.vector = vector
  }

  getVector(): VectorConfig | undefined {
    return this.vector
  }

  setTransform(transform: TransformConfig): void {
    this.transform = transform
  }

  getTransform(): TransformConfig | undefined {
    return this.transform
  }

  setOnCreateSet(isOnCreateSet = true): void {
    this.onCreateSet = isOnCreateSet
  }

  getOnCreateSet(): boolean {
    return this.onCreateSet
  }

  setOnMatchSet(isOnMatchSet = true): void {
    this.onMatchSet = isOnMatchSet
  }

  getOnMatchSet(): boolean {
    return this.onMatchSet
  }

  setAlwaysSet(isAlwaysSet = true): void {
    this.alwaysSet = isAlwaysSet
  }

  getAlwaysSet(): boolean {
    return this.alwaysSet
  }

  setFulltext(isFulltext = true): void {
    this.fulltext = isFulltext
  }

  getFulltext(): boolean {
    return this.fulltext
  }

  setDescription(description: string): void {
    this.description = description
  }

  getDescription(): string | undefined {
    return this.description
  }

  setEntity(entity: Newable): void {
    this.entity = entity
  }

  getEntity(): Newable | undefined {
    return this.entity
  }

  /**
  Merge the given rules over any previously stored ones
  */
  setRules(rules: Record<string, unknown>): void {
    this.rules = { ...this.rules, ...rules }
  }

  getRules(): Record<string, unknown> {
    return this.rules
  }

  setRelationshipType(relationshipType: string): void {
    this.relationshipType = relationshipType
  }

  getRelationshipType(): string | undefined {
    return this.relationshipType
  }

  setFields(fields: string[]): void {
    this.fields = fields
  }

  getFields(): string[] | undefined {
    return this.fields
  }

  setDirection(direction: Direction): void {
    this.projectionDirection = direction
  }

  getDirection(): Direction | undefined {
    return this.projectionDirection
  }

  setWhere(where: string): void {
    this.where = where
  }

  getWhere(): string | undefined {
    return this.where
  }

  setMinHops(minHops: number): void {
    this.minHops = minHops
  }

  getMinHops(): number | undefined {
    return this.minHops
  }

  setMaxHops(maxHops: number): void {
    this.maxHops = maxHops
  }

  getMaxHops(): number | undefined {
    return this.maxHops
  }

  setLabel(label: string): void {
    this.label = label
  }

  getLabel(): string | undefined {
    return this.label
  }

  setExpression(expression: string): void {
    this.expression = expression
  }

  getExpression(): string | undefined {
    return this.expression
  }

  setCompute(compute: (entity: unknown) => unknown): void {
    this.compute = compute
  }

  getCompute(): ((entity: unknown) => unknown) | undefined {
    return this.compute
  }
}

/**
True when the property projects a read-model value (see ProjectedPropertyTypes)
*/
export function isProjectedProperty(property: PropertySchema): boolean {
  return ProjectedPropertyTypes.includes(property.getType())
}
