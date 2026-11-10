import type { DefaultValue, TimestampFormat } from '../meta/property-schema.js'
import type {
  TransformConfig,
  VectorConfig,
  DerivedConfig,
} from '../meta/schema-definition.interface.js'

/**
Config for the @CreatedAt / @UpdatedAt decorators (NTS-612)
*/
export interface TimestampConfig {
  /**
  Which form the server-side stamp writes: 'datetime' (the default)
  stores the `datetime()` temporal, 'iso-string' stores its `toString()`
  rendering — an ISO-8601 string that compares lexically against
  client-supplied timestamps.
  */
  format?: TimestampFormat
}

export interface PropertyConfig {
  /**
  Property type name, as accepted by the @Property decorator (e.g. 'string', 'datetime').
  */
  type?: string
  array?: boolean
  default?: DefaultValue
  primary?: boolean
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
  create — the `@CreatedAt` decorator's config option.
  */
  createdAt?: boolean
  /**
  Server-side timestamp (NTS-165): stamped with `datetime()` on create and
  on every write — the `@UpdatedAt` decorator's config option.
  */
  updatedAt?: boolean
  /**
  Stamp form for a server-side timestamp (NTS-612): 'iso-string' renders
  the stamp as `toString(datetime())` so the stored value compares
  lexically against client ISO strings; the default stores the temporal.
  Set through `@CreatedAt` / `@UpdatedAt` config.
  */
  timestampFormat?: TimestampFormat
  /**
  Optimistic locking (NTS-158): the integer property every write keeps in
  sync — stamped 0 on create, incremented by 1 on every write addressed to
  the node, and checked with `WHERE n.version = $expected` when the
  instance carries the version it was hydrated with (a mismatch throws
  `OptimisticLockError`). The `@Version` decorator's config option.
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
  Include in the model's full-text search index, created by `installSchema()`
  and resolved by `Repository.search()` (NTS-436).
  */
  fulltext?: boolean
  /**
  Opt in to a property-type constraint generated from the declared type (NTS-141): `REQUIRE n.prop IS :: STRING`.
  */
  typed?: boolean
  /**
  Read-side fallbacks applied at hydration when the stored/projected
  value is null or absent (NTS-139, the Zod `.catch()` analogue): a
  literal, or sibling property names whose first non-null value wins.
  */
  coalesce?: string | string[]

  /**
  Free-text explanation of the property for LLM-agent-facing ontology
  emission (NTS-445): surfaced by `ontology()` / `ontologyMarkdown()`.
  */
  description?: string

  /**
  Per-property fake data generator (NTS-444): user-supplied, no faker
  dependency. Invoked by factory seeding (and the create path) when
  neither an explicit value nor `default` applies — precedence on
  create is explicit value > `default` > `fake`, and generated values
  are validated like any other write.
  */
  fake?: () => unknown

  /**
  Declare a vector index over the property (NTS-447): created by
  `installSchema()`, dropped by `dropSchema()`, searched by `knn()`.
  Also available standalone via the `@Vector` decorator.
  */
  vector?: VectorConfig

  /**
  Stored derived property (NTS-569): computed on the write path from the
  `from` source properties and stored like a hand-set value — exactly one
  of `compute` / `cypher`. Also available standalone via the `@Derived`
  decorator.
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
  neode validation rules (min, max, email, regex, …) — persisted as-is
  */
  [rule: string]: unknown
}
