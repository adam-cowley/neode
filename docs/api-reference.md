# neode-ogm — API Reference

The full public surface. Everything below is importable from the package root:

```typescript
import Neode, {
  // Core
  fromEnv,
  Repository,
  TransactionalService,
  Collection,
  toJson,
  valueToJson,
  // Events
  EventType,
  // Map-based schemas
  defineModel,
  extendModel,
  getModelByName,
  getModelsByName,
  // Repositories
  registerRepository,
  getRepository,
  resolveRepository,
  // Instance methods
  applyEntityMethods,
  setDefaultNeode,
  // Query builder
  Builder,
  Direction,
  toDirection,
  // Connection providers
  Neo4jConnectionProvider,
  RelateConnectionProvider,
  // Decorators (re-exported en bloc)
  NodeEntity,
  InternalId,
  Primary,
  Uuid,
  Property,
  String,
  Number,
  Boolean,
  Float,
  Date,
  Time,
  DateTime,
  LocalTime,
  LocalDateTime,
  Point,
  Duration,
  Default,
  OnCreateSet,
  OnMatchSet,
  Index,
  Unique,
  Required,
  Hidden,
  Protected,
  Readonly,
  OneToOne,
  OneToMany,
  RelationshipEntity,
  StartNode,
  EndNode,
  OtherNode,
  EntityRepository,
  // Read-model projections
  RelatedOne,
  RelatedMany,
  RelationshipCount,
  RelationshipExists,
  LabelPresent,
  Computed,
  Expression,
  Vector,
  // Errors
  NeodeError,
  ConstraintViolationError,
  TransientError,
  classifyError,
  isTransientError,
  // Query builder expressions & predicates
  expr,
  caseExpr,
  WhereNull,
  LabelPredicate,
  // Hydration & raw results
  hydrate,
  hydrateFirst,
  toCollection,
  jsonSafe,
  jsonSafeRecord,
  instrumentConnectionProvider,
  // Search
  search,
  knn,
  toFulltextQuery,
  FulltextIndexService,
  VectorIndexService,
  // Read services & helpers
  ProjectionService,
  projectionNode,
  hasProjectedProperties,
  hydrateProjection,
  mergeRelationshipProperty,
  // Schema inspection & drift
  inspectSchema,
  schemaDrift,
  formatSchemaDrift,
  applySchemaDrift,
  // Bulk & pagination
  BulkService,
  PaginateService,
  // Ops & testing
  verifyConnectivity,
  waitUntilReachable,
  ConnectivityTimeoutError,
  splitCypherStatements,
  runCypherScript,
  wipe,
  testId,
  // Agent ontology
  ontology,
  ontologyMarkdown,
  // Factories
  FactoryBuilder,
  // Types
  type EntityMethods,
  type WithMethods,
  type PropertyTypeName,
  type PropertyDefinition,
  type RelationshipDefinition,
  type SchemaDefinition,
  type SchemaDefinitionEntry,
  type ConnectionProvider,
  type ConnectionOptions,
  type TransactionHandle,
  type Runner,
  type QueryOutput,
  type QueryRecord,
  type QueryParams,
  type QuerySummary,
  type QueryExecutedEvent,
  type CypherOptions,
  type GraphNode,
  type GraphRelationship,
  type AccessMode,
  type RepositoryConstructor,
  type INeode,
  type ScoredEntity,
  type KnnMode,
  type FulltextIndexDefinition,
  type VectorIndexDefinition,
  type InspectOptions,
  type SchemaInspection,
  type SchemaDiff,
  type SchemaObject,
  type SchemaDrift,
  type SchemaDriftGroup,
  type SchemaDriftEntry,
  type ApplySchemaDiffOptions,
  type BulkChunk,
  type BulkOptions,
  type Page,
  type CursorPage,
  type PaginateOptions,
  type OffsetPaginateOptions,
  type CursorPaginateOptions,
  type RelatedOneDefinition,
  type RelatedManyDefinition,
  type RelationshipCountDefinition,
  type RelationshipExistsDefinition,
  type LabelPresentDefinition,
  type ExpressionDefinition,
  type ComputedDefinition,
  type VectorConfig,
  type TransformConfig,
  type ConnectivityConfig,
  type WaitUntilReachableOptions,
  type RunCypherScriptOptions,
  type WipeTarget,
  type Ontology,
  type EntityOntology,
  type PropertyOntology,
  type RelationshipOntology,
  type FactoryWithSpec,
} from 'neode'
```

- [Entities & decorators](#entities--decorators)
- [Validation rules](#validation-rules)
- [Map-based schema definitions](#map-based-schema-definitions)
- [The Neode facade](#the-neode-facade)
- [Query builder](#query-builder)
- [Transactions](#transactions)
- [Events](#events)
- [Repositories](#repositories)
- [Schema sync](#schema-sync)
- [Schema inspection & drift](#schema-inspection--drift)
- [Connection providers](#connection-providers)
- [Instance methods](#instance-methods)
- [Collection & serialisation](#collection--serialisation)
- [Raw Cypher & instrumentation](#raw-cypher--instrumentation)
- [Search: full-text & vectors](#search-full-text--vectors)
- [Read-model projections](#read-model-projections)
- [Bulk writes & pagination](#bulk-writes--pagination)
- [Factories & seeding](#factories--seeding)
- [Testing & ops](#testing--ops)
- [Errors](#errors)
- [Agent ontology](#agent-ontology)

---

## Entities & decorators

### `@NodeEntity(config?)`

Registers the class as a node entity. Config:

| Option   | Type       | Description                                                           |
| -------- | ---------- | --------------------------------------------------------------------- |
| `labels` | `string[]` | Labels to write. Defaults to `[ClassName]`. Labels are always sorted. |

```typescript
@NodeEntity({ labels: ['Person', 'Actor'] })
class Actor {
  /* … */
}
```

### Property type decorators

Every property must declare a type — either through `@Property({ type })` or a dedicated sugar decorator:

| Decorator                                                     | Type name   | Notes                                                                                                                           |
| ------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@Property(config?)`                                          | —           | The general form: `@Property({ type: 'string', index: true })`. **Preferred** — the sugar decorators below shadow global types. |
| `@String(config?)`                                            | `string`    | **Deprecated** (shadows the global `String`) — use `@Property({ type: 'string' })`.                                             |
| `@Number(config?)`                                            | `number`    |                                                                                                                                 |
| `@Int(config?)`                                               | —           | _not provided_ — use `@Property({ type: 'int' })`                                                                               |
| `@Float(config?)`                                             | `float`     |                                                                                                                                 |
| `@Boolean(config?)`                                           | `boolean`   |                                                                                                                                 |
| `@Uuid(config?)`                                              | `uuid`      | Generates `crypto.randomUUID()` by default unless the config sets its own `default`.                                            |
| `@Date`, `@Time`, `@DateTime`, `@LocalTime`, `@LocalDateTime` | temporal    | Accept strings, `Date`s or epoch millis; converted to driver temporal values.                                                   |
| `@Point`                                                      | `point`     | Accepts `{ x, y[, z] }` or `{ latitude, longitude[, height] }`.                                                                 |
| `@Duration`                                                   | `duration`  | Accepts `{ months, days, seconds, nanoseconds }`.                                                                               |
| `@InternalId()`                                               | internal id | Hydrated with the node's **elementId** on every read; never written.                                                            |

Valid `type` names for `@Property` / map schemas: `any`, `string`, `number`, `int`, `integer`, `float`, `boolean`, `uuid`, `date`, `time`, `datetime`, `localtime`, `localdatetime`, `point`, `duration`. Unknown names throw.

### Property config options

All of these are understood by `@Property` (and by the sugar decorators, which accept the same config):

| Option            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`            | Property type name (see table above).                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `array`           | Store as an array.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `primary`         | Primary key — the MERGE key for `save()`.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `unique`          | Unique constraint (created by `installSchema()`); unique values are always SET on merge.                                                                                                                                                                                                                                                                                                                                                                |
| `index`           | Index (created by `installSchema()`).                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `required`        | Required property — existence constraint in Enterprise mode.                                                                                                                                                                                                                                                                                                                                                                                            |
| `exists`          | Property existence constraint (Enterprise only).                                                                                                                                                                                                                                                                                                                                                                                                        |
| `default`         | Value or `(model, schema) => value`, resolved on create.                                                                                                                                                                                                                                                                                                                                                                                                |
| `onCreateSet`     | SET only on CREATE.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `onMatchSet`      | SET only on MATCH.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `alwaysSet`       | SET on every write.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `createdAt`       | Server-side timestamp — `datetime()` written once on create (`@CreatedAt`).                                                                                                                                                                                                                                                                                                                                                                             |
| `updatedAt`       | Server-side timestamp — `datetime()` written on create and every write (`@UpdatedAt`).                                                                                                                                                                                                                                                                                                                                                                  |
| `readonly`        | Excluded from `update()` writes.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `hidden`          | Excluded from `toJson()` output.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `protected`       | Excluded from hydration input.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `transform`       | `{ in?, out? }` — value → stored form on writes (may be async), stored form → value at hydration (sync).                                                                                                                                                                                                                                                                                                                                                |
| `derived`         | Stored derived property (NTS-569) — `@Derived({ from, compute \| cypher })` is the decorator form. See [Derived properties](#derived-properties).                                                                                                                                                                                                                                                                                                       |
| `vector`          | Vector-index declaration over the property — `@Vector({ dimensions, … })` is the decorator form. With `from` + `provider` the vector is computed on write from the source property (the library stays dependency-free); on `save()` it recomputes only when the source property is dirty, and an explicitly provided vector always wins. Vector properties persist through the dedicated vector write (`SET n.prop = $list`), never the inline pattern. |
| _(any other key)_ | Treated as a validation rule — see [Validation rules](#validation-rules).                                                                                                                                                                                                                                                                                                                                                                               |

### Property option decorators

Each applies the matching config option to the property it decorates:

`@Default(valueOrFn)` · `@OnCreateSet()` · `@OnMatchSet()` · `@CreatedAt()` · `@UpdatedAt()` · `@Index()` · `@Unique()` · `@Required()` · `@Hidden()` · `@Protected()` · `@Readonly()` · `@Primary(config?)`

`@Primary` marks the property as primary key; combine it with a type decorator (or use `@Uuid({ primary: true })`).

`@CreatedAt()` / `@UpdatedAt()` stamp the property server-side with `datetime()` — `@CreatedAt` once on create, `@UpdatedAt` on create and on every write — so clocks never drift across clients. Stack them with a type decorator (e.g. `@DateTime()`) for a declared type; `update()` never rewrites a `@CreatedAt` property, and a no-op save on a clean instance touches neither.

```typescript
@NodeEntity()
class Movie {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  title: string

  @Property({ type: 'datetime' })
  @Default(() => new Date().toISOString())
  createdAt: string
}
```

### Relationship decorators

```typescript
@OneToMany(targetFactory, type?, direction?, eager?)
target: Pet[];
```

| Decorator                                        | Signature                                                                | Description                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@OneToOne(config)`                              | `{ type, direction, target?, eager? }` — `target` is `() => EntityClass` | Single relationship. Without `target`, the type is read from `design:type` (needs `reflect-metadata` + `emitDecoratorMetadata`; unavailable for self-referential classes). |
| `@OneToMany(factory, type?, direction?, eager?)` | `factory: () => EntityClass`                                             | Many relationship (array). Defaults: `type: ''`, `direction: BOTH`.                                                                                                        |
| `@NodeEntity`-level                              | —                                                                        | For self-referential relationships, register the property through the metamodel after the class is defined (or use the map API).                                           |

`Direction` is the enum `INCOMING | OUTGOING | BOTH`; the legacy case-insensitive strings `'in' | 'out' | 'both'` (and `'IN' | 'OUT' | 'BOTH'`) are accepted anywhere a direction is taken — unknown values fall back to `BOTH`.

### Relationship entities

For relationships modelled as their own entity (with start/end nodes and edge properties):

```typescript
@RelationshipEntity()
class Rating {
  @InternalId() _id: string

  @StartNode(() => User) user: User
  @EndNode(() => Movie) movie: Movie

  @Property({ type: 'number' })
  score: number
}
```

`@StartNode(factory)` / `@EndNode(factory)` / `@OtherNode(factory)` mark the node properties; all three also register the class as a relationship entity.

### Read-model projection decorators

These declare values projected into the read query — one RETURN projection per read, no N+1 (see [Read-model projections](#read-model-projections)):

```typescript
@NodeEntity()
class Learner {
  @InternalId() _id: string

  @RelatedOne({ type: 'IN_COURSE', direction: 'out', target: () => Course, fields: ['title'] })
  course?: Pick<Course, 'title'> // nested read-only DTO

  @RelatedMany({ type: 'COMPLETED_LESSON', target: () => Lesson, fields: ['slug'] })
  completedLessons: string[] // single field → scalar array

  @RelationshipCount({ type: 'COMPLETED_LESSON', direction: 'out' })
  completedCount: number // inline COUNT { } subquery

  @RelationshipExists({ type: 'NEXT_LESSON', direction: 'out' })
  hasNextLesson: boolean // inline EXISTS { } boolean

  @LabelPresent('OptionalLesson')
  isOptional: boolean // true when the node has the label

  @Expression('size((this)-[:KNOWS]->())')
  friendCount: number // raw Cypher, `this` = the root node

  @Computed((entity) => `${entity.firstName} ${entity.lastName}`)
  fullName: string // computed in TypeScript after hydration
}
```

- `@RelatedOne(config)` / `@RelatedMany(config)` — `config`: `{ type, direction?, fields?, target? }`. Omit `fields` for full-entity eager loading; with a field subset the result projects flat (one field → scalar array, several → plain DTOs). With `target()`, `fields` is type-checked against the target's properties — pair it with `Pick<Target, ...>` on the annotated property so the annotation can't drift.
- **Multi-hop `path` (NTS-547)** — pass `path: [{ type, direction?, target? }, …]` instead of `type`: the hops chain in one pattern comprehension and the last hop binds the projected node. `fields` is required (projected form only); `target()` on the config label-filters and type-checks the final node, `target` on an intermediate hop label-filters that hop. End nodes reached through several paths dedupe on hydration. An optional `where` filters elements inside the comprehension — `node` is the final node, `this` the annotated node (`where: 'NOT (this)-[:CONTAINS]->(node)'` turns the co-purchase read into "not already ordered here"). `Course <- IN_COURSE - other students -COMPLETED_LESSON-> lessons` is `path: [{ type: 'IN_COURSE', direction: 'out' }, { type: 'IN_COURSE', direction: 'in' }, { type: 'COMPLETED_LESSON', direction: 'out' }]`.
- `@RelationshipCount({ type, direction?, where? })` / `@RelationshipExists({ type, direction?, where? })` — `where` uses `node` as the variable for the target node.
- `@Computed(fn)` — never sent to the database; runs after hydration.
- `@Vector({ dimensions, … })` (NTS-447) — declare a vector index over the property: `installSchema()` creates it, `dropSchema()` drops it, `knn()` searches it.

Config types: `RelatedConfig` (`{ type, direction?, fields?, target? }`), `RelationshipCountConfig` / `RelationshipExistsConfig` (`{ type, direction?, where? }`), `ProjectionDirection` (`Direction` or `'in' | 'out' | 'both'`), `VectorConfig` (`{ dimensions, similarityFunction?, from?, provider? }`) and `TransformConfig` (`{ in?, out? }`).

## Validation rules

Rules are plain keys in the property config, using neode's rule names, mapped onto Zod. Unknown rules throw `Not sure how to validate <rule> on <key>`. All failing checks are collected into one error.

**Any type**

| Rule                                  | Options     | Behaviour                                                                     |
| ------------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| `allow`                               | `unknown[]` | Whitelist — allowed values bypass every other check.                          |
| `valid`                               | `unknown[]` | Strict whitelist; combine with `insensitive` for case-insensitive comparison. |
| `invalid`                             | `unknown[]` | Forbidden values.                                                             |
| `required` / `optional` / `forbidden` | `true`      | Presence rules (carried by the metamodel).                                    |
| `strict`                              | `true`      | No coercion (the OGM never coerces — accepted as a no-op).                    |
| `strip`                               | `true`      | Accepted; carried by the metamodel.                                           |
| `empty`                               | `true`      | Accepted; empty values are treated as unset.                                  |

**Boolean** — `truthy: true`, `falsy: true`

**Numbers** (`number`, `int`, `integer`, `float`)

| Rule                    | Behaviour             |
| ----------------------- | --------------------- |
| `min` / `max`           | Inclusive bounds.     |
| `integer`               | Must be an integer.   |
| `precision`             | Max decimal places.   |
| `multiple`              | Multiple of a number. |
| `positive` / `negative` | Strict sign.          |
| `port`                  | Integer 0–65535.      |

**Strings**

| Rule                      | Options                                   | Behaviour                                         |
| ------------------------- | ----------------------------------------- | ------------------------------------------------- |
| `min` / `max`             | number                                    | Length bounds.                                    |
| `length`                  | number                                    | Exact length.                                     |
| `truncate`                | `true`                                    | With `max`: truncate instead of failing.          |
| `regex`                   | `RegExp` or `{ pattern, invert?, name? }` | Pattern match.                                    |
| `replace`                 | `{ pattern, replace }`                    | Replace matches (transform).                      |
| `alphanum` / `token`      | `true`                                    | Alphanumeric / alphanumeric + underscore.         |
| `email` / `ip` / `uri`    | `true` or options object                  | Format checks (`ip` accepts v4 + v6).             |
| `guid`                    | `true` or `{ version: 'uuidv4' }`         | UUID (any or v4).                                 |
| `hex`                     | `true` or `{ prefix?, byteAligned? }`     | Hex characters.                                   |
| `base64`                  | `true` or `{ paddingRequired? }`          | Base64.                                           |
| `hostname`                | `true`                                    | Valid hostname.                                   |
| `normalize`               | `true` or `{ form }`                      | Unicode normalise (transform).                    |
| `lowercase` / `uppercase` | `true`                                    | Case transform.                                   |
| `trim`                    | `true`                                    | Trim (transform).                                 |
| `isoDate` / `iso`         | `true`                                    | ISO 8601 date or datetime.                        |
| `insensitive`             | `true`                                    | Makes `valid`/`invalid`/`allow` case-insensitive. |
| `creditCard`              | `true`                                    | Luhn check.                                       |

**Temporals** (`date`, `time`, `datetime`, `localtime`, `localdatetime`) — `before` / `after` with a `Date`, date string or `'now'`.

Validation runs automatically on every write path (`save`, `create`, `update`). Failures throw a validation error whose `details` array carries one `{ path, message }` entry per failing check (and `.input` holds the rejected values):

```typescript
try {
  await neode.save(Object.assign(new User(), { email: 'nope' }))
} catch (e) {
  e.details // [{ path: ['email'], message: '"email" must be a valid email', … }]
}
```

## Map-based schema definitions

```typescript
neode.model('Person', {
  labels: ['Person'], // optional extra labels
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  age: 'number', // shorthand: type name only
  pets: {
    type: 'relationship', // 'relationship' | 'relationships' | 'node' | 'nodes'
    relationship: 'OWNS',
    direction: 'out', // 'in' | 'out' | 'both' (case-insensitive)
    target: 'Pet', // target model name
    eager: true,
  },
})
```

- **Property entries** are either a bare type name (`'number'`) or a full definition: `type` plus any of `array`, `default`, `primary`, `unique`, `onCreateSet`, `onMatchSet`, `alwaysSet`, `required`, `hidden`, `protected`, `readonly`, `index`, `exists` — plus validation rules (same [rule names](#validation-rules) as decorators).
- **Relationship entries** take `relationship`, `direction`, `target`, `eager?`, and `cascade?` (per-relationship cascade: deleting a node also deletes the nodes reached through that relationship, recursively — each level applies its own annotations). A `properties` key is parsed but edge properties are not writable yet.
- When no property is marked `primary`, the primary key falls back to `<first label lowercased>_id` (neode parity).

Registration functions:

| Function                                     | Description                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `neode.model(name, schema?)`                 | Define a model, or look up a previously defined one (throws when unknown).                          |
| `neode.with({ Name: schema, … })`            | Define many at once. Chainable.                                                                     |
| `neode.withDirectory(path)`                  | Register each module's default export in a directory as a model named after the file (`.js`/`.ts`). |
| `neode.extend(name, as, schema?)`            | Clone a model under a new name, adding the new name as an extra label, merging the schema on top.   |
| `defineModel(name, schema)`                  | Standalone registry version of `model(name, schema)` — no instance needed.                          |
| `extendModel(name, as, schema?)`             | Standalone version of `extend`.                                                                     |
| `getModelByName(name)` / `getModelsByName()` | Look up registered map models.                                                                      |

`mergeRelationshipProperty(constructor, key, type, target, direction, isMany, isEager?, description?)` registers a relationship property through the metamodel directly — the tooling-level escape hatch for relationships that decorators can't express (e.g. self-referential classes on legacy setups).

## The Neode facade

### Construction

```typescript
new Neode(connection: ConnectionProvider, enterprise?: boolean)

Neode.forDriver(driver: neo4j.Driver, database?: string, enterprise?: boolean): Neode
Neode.forRelate(database: unknown, namespace = 'neo4j', enterprise?: boolean): Neode
fromEnv(): Neode
```

Configuration: `setDatabase(db?)` sets the default database (per-call `database` arguments win), `setEnterprise(bool)` / `isEnterprise()`, `getConnection()` returns the `ConnectionProvider`, `getRunner()` a `Runner`.

### CRUD

All methods take an optional trailing `database?: string` override. Query methods return **hydrated entity instances**; `find`/`findById`/`getFirst`/`update`/`mergeOn` return `T | undefined` when nothing matches.

```typescript
neode.save<T>(entity: T, database?): Promise<T>
// MERGE on the primary key, re-hydrate. Idempotent per unique value.

neode.create<T>(constructor, properties?, database?): Promise<T>
// CREATE — nested relationship targets included — then hydrate.

neode.mergeOn<T>(constructor, match, set, database?): Promise<T | undefined>
// MERGE on the given match properties, then SET.

neode.find<T>(constructor, value: string, database?): Promise<T | undefined>
// By the schema's PRIMARY KEY.

neode.findById<T>(constructor, elementId: string, database?): Promise<T | undefined>
// By the node's elementId.

neode.get<T>(constructor, params, limit?, skip?, database?): Promise<T[]>
// Property match. Unknown keys are ignored.

neode.getFirst<T>(constructor, params, database?): Promise<T | undefined>

neode.all<T>(constructor, params?, order?, limit?, skip?, database?): Promise<T[]>
// order forms: 'name' | ['name', 'age'] | { name: 'DESC' } | [{ name: 'DESC' }] | { field, order? }

neode.update<T>(entity, properties?, database?): Promise<T | undefined>
// `+=` on the primary key: provided keys only, then re-hydrate.

neode.relate<From, To>(constructor, from, to, relationshipKey, properties?, forceCreate?, database?): Promise<GraphRelationship | undefined>
// MERGE the relationship (CREATE with forceCreate). The relationship is
// resolved by its KEY on the from-entity's schema.

neode.detach<From, To>(constructor, from, to, relationshipKey): Promise<{ from: From | undefined, to: To | undefined }>
// Remove the relationship of the key between the two nodes; returns both re-hydrated.

neode.delete<T>(entity, options?: DeleteOptions | string, database?): Promise<void>
// Deleting honours the schema's per-relationship `cascade: true` annotations;
// the options override them:
//   (no options)                             — cascade annotated relationships only
//   { cascade: true }                        — delete related nodes recursively, every relationship
//   { cascade: false }                       — cascade nothing, not even annotated relationships
//   { cascade: true, mode: 'detach' }        — remove relationships, keep nodes
//   { cascade: true, depth: 10 }             — cap recursion (default 10)
//   { soft: 'Archived' }                     — SET the label instead of deleting
// Legacy form delete(entity, database) — string second arg — still accepted.

neode.deleteAll<T>(constructor, params?, database?): Promise<number>
// One bulk DETACH DELETE of every match (schema-declared keys only); returns the count.

neode.withinDistance<T>(constructor, locationProperty, point, distance, params?, order?, limit?, skip?, database?): Promise<T[]>
// order: 'distance' orders by distance from the point.
```

Most of this surface is also available on hydrated entities as [instance methods](#instance-methods), and inside transactions (below).

### Cypher and batches

```typescript
neode.readCypher(query: string, params?: QueryParams, database?): Promise<QueryOutput>
neode.writeCypher(query: string, params?: QueryParams, database?): Promise<QueryOutput>
neode.cypher(query: string, params?: QueryParams, options?: CypherOptions): Promise<QueryOutput>
// Unified raw entry: values come back JSON-safe (Integer/temporal/Point
// converted, see jsonSafe below). Options: { routing?: 'READ' | 'WRITE',
// database?, alias? } — or { hydrate: ModelClass } to get hydrated
// entities instead of raw rows.
neode.explain(query: string, params?: QueryParams, options?: { database? }): Promise<unknown>
// EXPLAIN — returns the plan, never executes.
neode.profile(query: string, params?: QueryParams, options?: { database? }): Promise<unknown>
// PROFILE — executes (routes WRITE) and returns the profiled plan.
neode.batch(queries: Array<string | { query: string; params?: QueryParams }>, database?): Promise<QueryOutput[]>
// All statements in ONE write transaction; every statement is attempted,
// then rolled back on any failure (see Transactions).
```

`QueryOutput` is `{ records: QueryRecord[]; summary? }`; a `QueryRecord` offers `get(key)`, `has(key)`, `keys`.

### The rest of the facade

Beyond CRUD, the facade wraps most of the standalone services below (identical signatures, with the model/runner arguments resolved for you):

```typescript
neode.setDefaultRouting(routing: AccessMode): void // 'READ' | 'WRITE'

neode.merge<T>(constructor, properties?, database?): Promise<T | undefined>
// MERGE on the schema's merge fields (unique/primary); entity values in the
// properties create relationships (routed through save()).

neode.first<T>(constructor, key: string | Record<string, unknown>, value?, database?): Promise<T | undefined>
// Alias of getFirst: a params object, or key + value.

neode.query(): Builder // a fresh query Builder (see Query builder)
neode.close(): Promise<void>

neode.search<T>(constructor, indexName, query, limit?): Promise<ScoredEntity<T>[]>
neode.knn<T>(constructor, indexName, vector, k, mode?): Promise<ScoredEntity<T>[]>

neode.inspectSchema(options?: InspectOptions): Promise<SchemaInspection>
neode.schemaDiff(options?): Promise<SchemaDrift> // standalone: schemaDrift()
neode.formatSchemaDiff(diff: SchemaDrift): string // standalone: formatSchemaDrift()
neode.applySchemaDiff(diff, options?): Promise<SchemaResult[]> // standalone: applySchemaDrift()
neode.installFulltextIndexes(definitions): Promise<SchemaResult[]>
neode.dropFulltextIndexes(definitions): Promise<SchemaResult[]>
neode.installVectorIndexes(definitions): Promise<SchemaResult[]>
neode.dropVectorIndexes(definitions): Promise<SchemaResult[]>

neode.createMany<T>(constructor, rows?, options?): Promise<BulkChunk<T>[]>
neode.mergeMany<T>(constructor, rows?, options?): Promise<BulkChunk<T>[]>
neode.paginate<T>(constructor, filter?, options: PaginateOptions): Promise<Page<T> | CursorPage<T>>

neode.runCypherScript(script, options?): Promise<QueryOutput[]>
neode.ontology(): Ontology
neode.ontologyMarkdown(): string

neode.factory(model: string | Newable): FactoryBuilder
```

## Query builder

`Builder` is the fluent Cypher builder the facade uses internally, importable directly when you need statements the facade does not express. Every user value is parameterised — the generated query contains only aliases.

### `create()` / `merge()` — extra labels on nodes

Both take `(alias, labels, properties)`. `labels` is a single label, an **array of labels** (a multi-label node), or `false` for no label:

```typescript
import { Builder } from 'neode'

new Builder().create('p', ['Person', 'Admin'], { name: 'Adam' }).return('p').build()
// CREATE (p:Person:Admin { name: $p_name })\nRETURN p

new Builder().merge('p', ['Person', 'Admin'], { name: 'Adam' }).return('p').build()
// MERGE (p:Person:Admin { name: $p_name })\nRETURN p
// MERGE matches on ALL labels — the node must have :Person AND :Admin to match.
```

Model-defined labels work the same way on the facade: `@NodeEntity({ labels: ['Person', 'Actor'] })` (or the map API's `labels` key) gives the model every label, and every create/merge the facade performs writes — and for MERGE matches on — all of them. Labels are always sorted.

### Derived properties (NTS-569)

A **stored derived property** is computed on the write path from other properties and stored like a hand-set value — the write-time counterpart of `@Computed` (read-time, never stored):

```typescript
class Order {
  @Property({ type: 'datetime' }) orderDate: string
  @Property({ type: 'datetime' }) shippedDate?: string

  // TypeScript-side: runs against the entity's property record
  @Property({ type: 'duration' })
  @Derived({
    from: ['orderDate', 'shippedDate'],
    compute: (o) => durationBetween(String(o.orderDate), String(o.shippedDate)),
  })
  timeToShip?: unknown

  // Cypher-side: evaluated by the database inside the write statement,
  // `this` = the written node with the sources' new values applied
  @Property({ type: 'number' })
  @Derived({
    from: ['orderDate', 'shippedDate'],
    cypher: 'duration.between(this.orderDate, this.shippedDate).days',
  })
  daysToShip?: number
}
```

Semantics, mirroring the vector `from` + `provider` sugar (NTS-449):

- A write that touches **any** `from` source (explicit value, default or dirty key) recomputes the derived property — on every write path: `create()`, `save()`/`merge()` (tracked saves recompute only from a dirty source, NTS-157), `mergeOn()`, `update()` patches and bulk `createMany()`/`mergeMany()`.
- An **explicitly provided** derived value in the same payload always wins.
- `compute` sees the entity's property record; on the `update()` patch path the record is stored-domain (the entity's stored values under the transformed patch), and the output skips `in` transforms. On every other path the record is user-domain and the output flows through `in` transforms and validation like a hand-set value.
- A compute-side derivation requires every source to hold a value in the payload — a partially available source set (e.g. an order with no `shippedDate` yet) leaves the stored value alone. A cypher-side expression must tolerate its own missing sources (`SET n.prop = null` removes the property; guard with `CASE WHEN …` if a stale value should survive).
- Cypher-side sets render as their own `SET` clause after the sources are written — plain Neo4j applies them in order; bulk rows coalesce the row's explicit value over the expression.
- Exactly one of `compute` / `cypher` is required, and every `from` source must be a declared property — violations throw on the model's first write.
- On tracked saves the recomputed keys join the write set even though the instance did not change them (the stored value is stale by definition). The entity returned by the write carries the fresh values; an instance that hand-set the derived property keeps its own.

Map API: `derived: { from, compute | cypher }` on the property definition.

### `expr` / `caseExpr` — Cypher expression helpers

`expr` is a map of single-expression helpers for RETURN / SET / WHERE positions (`expr.coalesce('a', 'b')`, `expr.count()`, `expr.exists(pattern)`, `expr.datetime()`, `expr.any(v, list, predicate)`, `expr.listComprehension(pattern, projection)`, …). `caseExpr(pairs, fallback?)` builds `CASE WHEN … THEN … [ELSE …] END`. They compose structure only — every value stays a bound parameter.

### Predicates: `WhereNull`, `LabelPredicate`

Builder helpers built on two small exported classes:

```typescript
new Builder().match('n').whereNull('n.deletedAt') // WHERE n.deletedAt IS NULL
new Builder().match('n').whereLabel('n', 'Completed') // WHERE n:Completed
new Builder().match('n').orderByLabel('n', 'Completed', 'DESC') // ORDER BY n:Completed DESC
```

`WhereNull(property)` renders `prop IS [NOT] NULL`; `LabelPredicate(alias, labels, isNegative?)` renders `[NOT ]alias:Label` (several labels require all of them). Both are exported so custom predicate code can reuse the same rendering.

## Transactions

```typescript
const tx = await neode.openWriteTransaction() // or openReadTransaction()
try {
  await tx.save(adam)
  await tx.relate(Person, adam, joe, 'knows', { since: '2024-01-01' })
  await tx.commit() // …or tx.rollback()
} catch (e) {
  await tx.rollback()
  throw e
}
```

A `TransactionalService` (what `open*Transaction` returns) exposes `commit()`, `rollback()`, `getRunner()`, `getTransaction()` and the query surface — `save`, `update`, `delete`, `find`, `findById`, `get`, `getFirst`, `all`, `relate`, `detach`, `withinDistance`, `readCypher`, `writeCypher` — scoped to the transaction. (`create` and `mergeOn` are facade-only.)

The callback form handles rollback for you when the callback throws:

```typescript
await neode.inWriteTransaction(async (tx) => {
  /* … */ return result
})
await neode.inReadTransaction(async (tx) => {
  /* … */ return result
})
```

Lower-level handles (if you want to drive the connection port yourself): `readTransaction(database?)` / `writeTransaction(database?)` return a `TransactionHandle` — a `Runner` (`run(statement, params?)`) plus `commit()` / `rollback()`.

### batch() and TransactionError

`neode.batch(queries, database?)` runs every statement in **one** write transaction. Every statement is attempted; on any failure the transaction rolls back and a `TransactionError` is thrown, carrying:

- `errors: (BatchStatementError | null)[]` — aligned with the input array, `null` where a statement succeeded,
- `results: QueryOutput[]` — results produced before the failure,
- `details: BatchStatementError[]` — `{ index, query, params, error }` per failed statement.

## Events

Subscribe with `neode.on(event, handler)` — returns the instance for chaining; `neode.off(event, handler)` unsubscribes. Events are emitted synchronously on an emitter scoped to the instance, and also fire for work done inside transactions.

| Event                                                                   | Emitted by                                                   | Payload             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------- |
| `EventType.NODE_CREATED`                                                | `create()`, `save()` when the merge created the node         | hydrated entity     |
| `EventType.NODE_UPDATED`                                                | `save()` when the merge matched and updated an existing node | hydrated entity     |
| `EventType.NODE_DELETED`                                                | `delete()` (not for soft deletes — the node survives)        | deleted entity      |
| `EventType.RELATIONSHIP_CREATED`                                        | `relate()` with `forceCreate`                                | `GraphRelationship` |
| `EventType.RELATIONSHIP_MERGED`                                         | `relate()` (MERGE, the default)                              | `GraphRelationship` |
| `EventType.NODE_MERGED`, `RELATIONSHIP_UPDATED`, `RELATIONSHIP_DELETED` | reserved                                                     | —                   |

```typescript
neode.on(EventType.NODE_CREATED, (entity) => console.log('created', entity))
```

## Repositories

```typescript
const people = neode.getRepository(Person)

await people.save(adam)
await people.findAll({ age: 30 }, { order: { name: 'DESC' }, limit: 10, skip: 0 })
await people.count({ age: 30 })
```

`Repository<Entity>` methods:

| Method          | Signature                                                             | Description                                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `find`          | `(id) => Promise<Entity \| undefined>`                                | By primary key.                                                                                                                                                                                                                               |
| `findBy`        | `(params?) => Promise<Entity \| undefined>`                           | First match.                                                                                                                                                                                                                                  |
| `findAll`       | `(params?, options?: { order?, limit?, skip? }) => Promise<Entity[]>` | `order` takes the same `OrderSpec` forms as `all()`.                                                                                                                                                                                          |
| `where`         | `(params?) => Promise<Entity[]>`                                      | Alias of `findAll(params)`.                                                                                                                                                                                                                   |
| `count`         | `(params?) => Promise<number>`                                        |                                                                                                                                                                                                                                               |
| `save`          | `(object) => Promise<Entity>`                                         | MERGE on primary key.                                                                                                                                                                                                                         |
| `saveAll`       | `(objects) => Promise<Entity[]>`                                      | One save (one write transaction) at a time.                                                                                                                                                                                                   |
| `patch`         | `(entity, properties) => Promise<Entity>`                             | Apply a patch, then persist via save. Named `patch` so domain interfaces declaring their own `update(id, input)` can be implemented by subclasses (NTS-454/458/459).                                                                          |
| `delete`        | `(entityOrId, { ifExists?, ...deleteOptions }) => Promise<void>`      | By instance or primary key value. Throws on a missing ID; `{ ifExists: true }` silently no-ops (NTS-457). Cascade options forward to the delete service — annotations decide by default, `{ cascade: true }` / `{ cascade: false }` override. |
| `increment`     | `(entityOrId, property, by?, { ifExists? }) => Promise<number>`       | Atomic `SET n.prop = coalesce(n.prop, 0) + by` (NTS-435). Returns the new value, or 0 when missing with `ifExists` (NTS-455).                                                                                                                 |
| `countBy`       | `(property, params?) => Promise<Record<string, number>>`              | Grouped counts over one declared property (NTS-453).                                                                                                                                                                                          |
| `deleteAll`     | `(params?) => Promise<number>`                                        | One bulk `DETACH DELETE` of every match; returns the count. No cascade, no per-node events.                                                                                                                                                   |
| `getPrimaryKey` | `() => PropertySchema`                                                |                                                                                                                                                                                                                                               |

### Custom repositories

```typescript
import { Repository, EntityRepository } from 'neode'

@EntityRepository(Person)
class PeopleRepository extends Repository<Person> {
  findAdults(): Promise<Person[]> {
    return this.findAll().then((people) => people.filter((p) => p.age >= 18))
  }
}

const people = neode.getRepository(Person) // → PeopleRepository
```

`neode.getRepository(entity, database?)` resolves a registered subclass when one exists, else the base `Repository`. Registry functions `registerRepository(entity, repository)`, `getRepository(entity)` and `resolveRepository(neode, entity, database?)` are exported for tooling.

## Schema sync

Constraints and indexes declared in the model config (`unique`, `index`, `required`/`exists`) are installed with modern, idempotent Cypher and deterministic names, so `dropSchema()` reverses `installSchema()` exactly:

```typescript
const results = await neode.installSchema()
// SchemaResult[]: { action, type, label, property, statement, success, error? }

await neode.dropSchema()
```

Property-existence constraints (`REQUIRE n.prop IS NOT NULL`) are Enterprise-only — enable enterprise mode or the statements are skipped.

## Schema inspection & drift

Read the installed schema and diff it against the declared models — cheap, read-only, and drift-never-throws (drift is data, not an error; failing CI on a non-empty diff is the caller's job):

```typescript
import { inspectSchema, schemaDrift, formatSchemaDrift, applySchemaDrift } from 'neode'

const inspection = await inspectSchema(connection, { fulltext?: […], vector?: […], enterprise? })
// SchemaInspection: { constraints: SchemaDiff, indexes: SchemaDiff }
// SchemaDiff: { installed, declared, missing, stale, mismatched } — SchemaObject rows

const drift = await schemaDrift(connection, options?) // structured, with the exact fix statement per entry
console.log(formatSchemaDrift(drift)) // human-readable, grouped by missing / stale / mismatched

await applySchemaDrift(connection, drift, { dropStale?: boolean }) // idempotent apply (IF NOT EXISTS)
```

- `schemaDrift` — declared-vs-installed inspection of constraints and every index kind (range/text/fulltext/vector), one `SchemaDriftEntry` per object carrying the CREATE/DROP statement that would resolve it. `SchemaDriftGroup` groups one family by action; `ApplySchemaDiffOptions.dropStale` also drops installed-but-undeclared objects (destructive, off by default).
- `applySchemaDrift` — apply the missing objects idempotently; mismatched objects are never auto-applied; stale objects only dropped with `dropStale: true`. Each statement is reported with a `SchemaResult`.
- The facade mirrors these as `neode.inspectSchema(options?)`, `neode.schemaDiff(options?)`, `neode.formatSchemaDiff(diff)` and `neode.applySchemaDiff(diff, options?)` — they pass the instance's connection and declared index definitions for you.

## Soft delete

`@SoftDelete` (NTS-510) turns delete into a stamp and makes every standard read exclude the stamped rows — a global filter you don't have to remember:

```typescript
import { SoftDelete } from 'neode'

@NodeEntity()
@SoftDelete() // label defaults to 'Deleted'
class Product {
  @Primary() @Property({ type: 'number' }) productID!: number
  @Property({ type: 'string' }) name!: string
}

await repo.delete('p1') // SETs :Deleted + deletedAt = datetime()
await repo.find('p1') // undefined — filtered
await repo.findAll({}, { includeDeleted: true }) // opts back in
await repo.restore('p1') // removes the label + stamp
await repo.delete('p1', { force: true }) // real DETACH DELETE
```

- The filter applies to `find` / `findById` / `findBy` / `findAll` / `all()` / projections / `count()` / `countBy()` and both transaction scopes.
- `deleteAll()` stays a hard bulk delete by design; full-text and kNN search do not filter (they hit the index directly) — filter those results or use standard reads.
- `restore(entityOrId)` throws on models without `@SoftDelete`.

## Observers

`neode.observe(Model, hooks)` (NTS-511) — lifecycle hooks composed over the write paths of both scopes (facade and open transactions). Registration order runs; an error in a before-hook fails the write and rolls the transaction back:

```typescript
const off = neode.observe(Product, {
  beforeSave: (entity) => {
    entity.slug ??= slugify(entity.name)
  }, // create path: receives the properties record
  afterSave: (entity, { isNew }) => audit.log(isNew ? 'created' : 'updated', entity),
  beforeDelete: (entity) => {
    if (entity.protected) throw new Error('protected')
  },
  afterDelete: (entity) => audit.log('deleted', entity),
})
```

- `beforeSave` runs before the dirty diff, so observer mutations count as changes; on the create path it receives the mutable properties record (the entity does not exist yet).
- `afterSave` context: `{ isNew, database }` — `isNew` mirrors whether the merge created the node.
- Soft deletes fire `beforeDelete`/`afterDelete` (the entity left the read model) but not the `NODE_DELETED` event (the node stays).
- Returns the off function.

## Traversals

`neode.traverse(Model)` (NTS-512) — typed multi-hop reads through the Builder, one hydrated row per matched path:

```typescript
const rows = await neode
  .traverse(Product)
  .where({ productID: 1 }) // declared-property filters on the start node
  .hop('SUPPLIED_BY', 'out', Supplier) // class or lazy thunk
  .hop('COVERS', 'in', Territory, { degrees: '1..2' }) // variable-length hop
  .run()

rows[0].nodes // [Product, Supplier, Territory] — hydrated entities
```

- Each node is hydrated with the registered model whose labels match the node (most specific wins); unmatched nodes come back as raw driver nodes.
- Variable degrees fan out rows (one per matched path). Relationship properties are available via `Repository#matchEntity`-style follow-ups or raw reads.
- Hops render through the same parameterised Builder as everything else — no string interpolation.

### Aggregate traversals (NTS-547)

The same builder runs as an aggregate read — the co-purchase shape ("entities reached through shared origins, ranked by how many origins they share, excluding the ones already connected to the start"):

```typescript
const rows = await neode
  .traverse(Order)
  .where({ orderID })
  .hop('CONTAINS', 'out', Product) //  t1: this order's products
  .hop('CONTAINS', 'in', Order) //    t2: other orders…
  .hop('CONTAINS', 'out', Product) // t3: …and what they contain
  .exclude('t0', 'CONTAINS', 't3') // not already in THIS order
  .groupBy('t3')
  .countDistinct('t2', 'times')
  .orderBy('times', 'DESC')
  .limit(5)
  .runAggregates()

// rows: [{ t3: Product (hydrated), times: 4 }, …]
```

- `.exclude(from, type, to)` renders `WHERE NOT (from)-[:TYPE]->(to)`; aliases are the hop positions `t0…tN`.
- `runAggregates()` requires `.countDistinct(alias, as)`; with no `.groupBy()`, the count is a single global row.
- `run()` keeps its path-row shape — the two modes never mix.

## Connection providers

The database-agnostic port every backend implements:

```typescript
interface ConnectionProvider {
  run(statement, parameters?, mode?: 'READ' | 'WRITE', database?): Promise<QueryOutput>
  beginTransaction(mode?, database?): Promise<TransactionHandle>
  edition(): Promise<'enterprise' | 'community' | 'unknown'>
  close(): Promise<void>
}
```

Two ship out of the box:

| Provider                                                  | Backends                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `Neo4jConnectionProvider(driver, database?)`              | Neo4j Community/Enterprise, Aura, Memgraph — anything speaking Bolt           |
| `RelateConnectionProvider(database, namespace = 'neo4j')` | The embedded [Relate](https://github.com/relateapp/relate) engine, in-process |

Two option types round out the port: `ConnectionOptions` (`{ defaultRouting?: 'READ' | 'WRITE' }` — used when a query path leaves the routing open; `neode.setDefaultRouting()` sets it on the facade) and `QuerySummary` (`{ counters?, plan?, profile? }`, the `summary` of a `QueryOutput`). `INeode` is the structural interface of the `Neode` facade (find/save/delete/cypher/search/…) — accept it as a constructor parameter to keep services mockable without depending on the concrete class.

### `fromEnv()` environment variables

| Variable                                                                                                                                                                 | Meaning                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `NEO4J_URI`                                                                                                                                                              | Full URI; wins over the protocol/host/port triple.                                              |
| `NEO4J_PROTOCOL` / `NEO4J_HOST` / `NEO4J_PORT`                                                                                                                           | Defaults `bolt` / `localhost` / `7687`.                                                         |
| `NEO4J_USERNAME` / `NEO4J_PASSWORD`                                                                                                                                      | Auth (optional).                                                                                |
| `NEO4J_DATABASE`                                                                                                                                                         | Default database (`neo4j`).                                                                     |
| `NEO4J_ENTERPRISE`                                                                                                                                                       | `'true'` enables enterprise features (existence constraints).                                   |
| `NEO4J_ENCRYPTION`                                                                                                                                                       | `'true'`/`'false'` or `ENCRYPTION_ON`/`ENCRYPTION_OFF`.                                         |
| `NEO4J_TRUST`                                                                                                                                                            | Driver-6 trust strategy (e.g. `TRUST_ALL_CERTIFICATES`, `TRUST_SYSTEM_CA_SIGNED_CERTIFICATES`). |
| `NEO4J_TRUSTED_CERTIFICATES`                                                                                                                                             | Comma-separated certificate paths.                                                              |
| `NEO4J_LOGGING_LEVEL`                                                                                                                                                    | `error` \| `warn` \| `info` \| `debug`.                                                         |
| `NEO4J_MAX_CONNECTION_POOLSIZE`, `NEO4J_MAX_TRANSACTION_RETRY_TIME`, `NEO4J_MAX_CONNECTION_LIFETIME`, `NEO4J_CONNECTION_TIMEOUT`, `NEO4J_CONNECTION_ACQUISITION_TIMEOUT` | Numeric driver config.                                                                          |
| `NEO4J_DISABLE_LOSSLESS_INTEGERS`                                                                                                                                        | `'true'` → numbers instead of `Integer` instances.                                              |
| `NEO4J_KNOWN_HOSTS`, `NEO4J_LOAD_BALANCING_STRATEGY`                                                                                                                     | Ignored with a warning — removed in `neo4j-driver` 6.                                           |

### Capability probing (test harness)

Integration suites pick a backend with `OGM_TEST_BACKEND` and probe what it supports before asserting backend-specific behaviour:

| Value              | Backend                                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `relate` (default) | Embedded Relate engine, in-memory, zero setup                                                                                                                           |
| `neo4j`            | External Neo4j (Community/Enterprise) — needs `NEO4J_USERNAME`/`NEO4J_PASSWORD`, optionally `NEO4J_URI` or `NEO4J_PROTOCOL`/`NEO4J_HOST`/`NEO4J_PORT`, `NEO4J_DATABASE` |
| `memgraph`         | External Memgraph — same env vars                                                                                                                                       |

Probed capabilities: `edition`, `constraints` (unique/existence + indexes), `temporals`, `points`, `multiDatabase` — skip tests the backend can't support (e.g. enterprise-only constraints on Community).

## Consumer field guide

Everything below was learned building a real consumer app (the Northwind demo) — the things the API reference can't tell you.

### Tooling with stage-3 decorators

The decorators are standard TC39 (no `experimentalDecorators`, no `reflect-metadata`). Not every TypeScript toolchain lowers them yet:

| Tool                      | Decorated model files                      | Notes                                                                                                        |
| ------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `vitest` (esbuild)        | ✅ works                                   | The library's own test suite runs on this                                                                    |
| `esbuild` (bundler)       | ✅ works                                   | Use for app/server bundles containing decorated classes                                                      |
| `tsdown` / rolldown / oxc | ❌ passes decorators through untransformed | oxc#9170 — output throws `SyntaxError`. Bundle undecorated library code only, or mark the library `external` |
| Vite ≤ 7 (esbuild)        | ✅ works                                   |                                                                                                              |
| Vite 8+ (oxc)             | ❌ same oxc gap                            | Workaround: `@rolldown/plugin-babel` + `@babel/plugin-proposal-decorators`                                   |
| `tsx`                     | ✅ works (esbuild underneath)              |                                                                                                              |

When bundling a server that imports `neode`, keep it **external** (`--external:neode`): the package resolves its optional embedded-engine client relative to its own location, which survives the node_modules symlink only when unbundled.

### Writing values by property type

What each type accepts on write (all write paths — `create`/`save`/`merge`/`update`/bulk — run values through the same conversion), and what hydration hands back:

| Type                       | Accepted on write                                                                                                  | Hydrated as                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `string`                   | string (numbers coerced)                                                                                           | string                                      |
| `number` / `int` / `float` | number; integer-valued reads arrive as a lazy numeric — coerce with `+value`                                       | number                                      |
| `boolean`                  | boolean                                                                                                            | boolean                                     |
| `uuid`                     | string (generated when unset)                                                                                      | string                                      |
| `datetime`                 | ISO string **with zone** (`2020-01-01T00:00:00Z`) or driver instance; a zone-less string is rejected by the server | driver `DateTime` / decoded temporal object |
| `date`                     | `YYYY-MM-DD` string or driver instance                                                                             | driver `Date` / `{ year, month, day }`      |
| `time` / `localtime`       | `HH:mm:ss(.sss)Z?`                                                                                                 | driver `Time` / `{ hour, … }`               |
| `localdatetime`            | zone-less ISO datetime                                                                                             | decoded object                              |
| `duration`                 | `{ months, days, seconds, nanoseconds }` (an ISO string is NOT accepted)                                           | driver `Duration`                           |
| `point`                    | `{ latitude, longitude[, height] }` (→ SRID 4326) or `{ x, y[, z] }` (→ cartesian 7203) or driver `Point`          | driver `Point` `{ srid, x, y }`             |
| arrays                     | as above with `array: true`                                                                                        | list                                        |

Three rules the hard way teaches:

1. **Absent beats empty string.** `''` is Joi-unset on write (skipped) but some engines reject empty-string _parameters_ outright — write the property as absent, not empty.
2. **`undefined` keys don't survive raw statements.** The OGM's own write paths skip them; a hand-rolled Builder statement must compact the record first (`Object.entries(...).filter(([, v]) => v !== undefined)`).
3. **Relationship keys ≠ relationship types.** `relate(entity, other, 'placedBy')` takes the declared FIELD key; the Cypher pattern uses the TYPE (`:PLACED_BY`). The projection decorators take types.

### Embedded engine vs real server

What differs when running tests on the embedded engine (`OGM_TEST_BACKEND=relate`, zero setup) vs a real Neo4j:

| Capability                                       | Embedded Relate                       | Real Neo4j 5/2025               |
| ------------------------------------------------ | ------------------------------------- | ------------------------------- |
| Constraints, range/fulltext/vector indexes       | ✅                                    | ✅                              |
| `COUNT { }` / `EXISTS { }` subquery projections  | ✅                                    | ✅                              |
| Pattern comprehensions in RETURN (`@RelatedOne`) | ✅                                    | ✅                              |
| Vector writes via plain `SET n.prop = $list`     | ✅                                    | ✅                              |
| `db.create.setNodeVectorProperty` procedure      | ❌                                    | ✅ (the library never needs it) |
| Empty-string query parameters                    | ❌ rejected — write absent properties | ✅                              |
| Property-existence constraints, multi-database   | ❌ (Enterprise features)              | Enterprise                      |

### App structure that scales

Two scopes, one rule: **repositories take `INeode`** (the minimal interface — they keep working inside `openWriteTransaction()` scopes), **services take the concrete facade** (they own transactions, runners, pagination). The demo's split:

- `models/` — decorators + validation, no logic
- `repositories/` — queries on the `INeode` surface (reads, `Builder` + `readCypher`, simple writes)
- `services/` — orchestration on the facade: `openWriteTransaction()`, `PaginateService(runner)`, `knn(runner, …)`, `batch()`
- `api/` — a listen-free Hono app (`app.request()` in tests, no network)

## Instance methods

Hydrated entities get active-record methods on their prototype (wired once per class at first hydration):

```typescript
interface EntityMethods {
  save(): Promise<this> // MERGE, re-hydrate
  update(properties?: Record<string, unknown>): Promise<this> // `+=`, re-hydrate
  delete(options?: { cascade?; mode?; depth?; soft? } | string): Promise<this>
  // With { soft: 'Archived' } the label is SET instead and the refreshed
  // entity is returned; otherwise the node is deleted and the (detached)
  // instance is returned.
  addLabel(label: string): Promise<this> // SET n:Label, re-hydrate
  removeLabel(label: string): Promise<this> // REMOVE n:Label, re-hydrate
  relateTo(
    other: object,
    relationshipKey: string,
    properties?,
    shouldForceCreate?,
  ): Promise<GraphRelationship | undefined>
  detachFrom<To extends object>(other: To, relationshipKey: string): Promise<{ from; to }>
  toJson(): Record<string, unknown>
}
```

```typescript
const adam = await neode.create(Person, { name: 'Adam' })
await adam.save() // works at runtime on any hydrated instance
```

**Typing caveat.** These methods are attached at hydration time, so TypeScript does not see them on your class. Use the `WithMethods<T>` helper for type-checking — the facade returns `Promise<T>` typed as your class, so cast once:

```typescript
import type { WithMethods } from 'neode'

const adam = (await neode.create(Person, { name: 'Adam' })) as WithMethods<Person>
await adam.update({ age: 31 })
```

Notes:

- The methods need a `Neode` instance: the most recently constructed one wins (`setDefaultNeode(neode)` pins it explicitly).
- User-defined methods with the same name are never clobbered — the rest still apply.
- `applyEntityMethods(constructor, neode?)` wires the methods manually if you construct entities outside hydration.

## Collection & serialisation

Facade queries return **plain arrays** of hydrated entities. `Collection<T>` is exported for when you want neode's wrapper: `length`, iteration (`for…of`, spread), `get(i)`, `first()`, `map(fn)`, `find(fn)`, `forEach(fn)`, `Collection.from(iterable)`.

```typescript
import { toJson, valueToJson } from 'neode'

const json = toJson(person)
// { _id: elementId, _labels: ['Person'], name: 'Adam', pets: [ … ] }
```

- `toJson(entity)` → JSON-friendly object: `hidden` properties and structural properties are skipped, `_id` carries the elementId (when the model declares `@InternalId`), `_labels` the schema's labels, and eagerly loaded relationships serialise recursively. Driver temporals/points become ISO strings / coordinate objects. Throws when no model is registered for the value.
- `valueToJson(value, property)` → the same conversion for a single property value.

## Raw Cypher & instrumentation

### `hydrate` / `hydrateFirst` / `toCollection`

```typescript
hydrate<T>(constructor, output: QueryOutput, alias = 'this'): WithMethods<T>[]
hydrateFirst<T>(constructor, output: QueryOutput, alias = 'this'): WithMethods<T> | undefined
toCollection<T>(constructor, output: QueryOutput, alias = 'this'): Collection<T>
```

Hydrate a raw query result (as returned by `readCypher`/`writeCypher` or `Builder.build()` executed manually) into typed entities: each record's `alias` column is the node, any other column feeds eager relationship hydration (neode's `Factory.hydrate`). `hydrateFirst` returns `undefined` for an empty result; `toCollection` wraps the entities in a `Collection`.

### `jsonSafe` / `jsonSafeRecord`

```typescript
jsonSafe(value: unknown): unknown
jsonSafeRecord(record: QueryRecord): QueryRecord
```

JSON-safe serialisation for raw query values: converts the driver class instances that survive value normalisation (`Integer`, temporal types, `Point`, `Path`) and bigints into structures that survive `JSON.stringify`, recursing through arrays and plain objects. Everything else passes through unchanged. `jsonSafeRecord` converts one record's values — `neode.cypher()` applies it for you.

### `instrumentConnectionProvider`

```typescript
instrumentConnectionProvider(
  inner: ConnectionProvider,
  onQuery: (event: QueryExecutedEvent) => void,
): ConnectionProvider
```

Wrap a provider transparently: every statement run through it (inside or outside transactions) fires `onQuery` with a `QueryExecutedEvent` — `{ cypher, params, duration, database? }`. Property reads the wrapper doesn't satisfy forward to the inner provider, so consumers holding `getConnection()` see through the instrumentation.

## Search: full-text & vectors

```typescript
import { search, knn, toFulltextQuery } from 'neode'

const vectorHits = await knn(runner, Person, 'person_plot_vector', vector, 5)
const textHits = await search(runner, Person, 'person_plot', toFulltextQuery(query))
```

```typescript
search<T>(runner, model, indexName: string, query: string, limit?: number): Promise<ScoredEntity<T>[]>
knn<T>(runner, model, indexName: string, vector: number[], k: number, mode?: KnnMode): Promise<ScoredEntity<T>[]>
toFulltextQuery(text: string, maxTerms?: number): string
```

- `search` — full-text search over a full-text index (`CALL db.index.fulltext.queryNodes`), returning hydrated entities with their relevance score, best match first. The query string is bound as a parameter, so Lucene syntax characters in it are still parsed as such — pass user text through `toFulltextQuery` first (it strips Lucene special characters and operators, lowercases, and caps the term count).
- `knn` — k-nearest-neighbour search over a vector index. With the default `auto` mode the Cypher 25 `SEARCH` clause is attempted first and the `queryNodes` procedure is the fallback; `mode: 'search-clause' | 'procedure'` pins one form.
- `model` takes a registered class or its schema; `ScoredEntity<T>` is `{ entity: T, score: number }`; `KnnMode` is `'auto' | 'search-clause' | 'procedure'`.
- **Pitfall — top-k before filters:** the vector search picks its top `k` neighbours _before_ any filter is applied (the same behaviour Spring Data Neo4j and neomodel warn about), so a filtered kNN can return fewer than `k` rows — or none. Over-fetch by requesting a larger `k`, then filter the hydrated entities in your code.

The facade wrappers (`neode.search(...)`, `neode.knn(...)`) pass the instance's connection for you.

### Index services

```typescript
new FulltextIndexService(connection, definitions: FulltextIndexDefinition[])
new VectorIndexService(connection, definitions: VectorIndexDefinition[])
// .create() / .drop() → Promise<SchemaResult[]>
```

```typescript
{ label: 'Person', properties: ['name', 'plot'], name?: string } // FulltextIndexDefinition
{ label: 'Person', property: 'plot', dimensions: 1536, similarityFunction?: 'cosine' | 'euclidean', name?: string } // VectorIndexDefinition
```

Both follow the result-reporting pattern of `installSchema()`. Index names default to `<label>_<props joined by _>_fulltext` / `<label>_<property>_vector`. The facade wraps them: `installFulltextIndexes(definitions)` and friends.

## Read-model projections

Declarative read models composed into a single RETURN projection per read — one Cypher query, no N+1. Declared with the [projection decorators](#read-model-projection-decorators); read through `ProjectionService` or the facade's query methods, which switch to the projection automatically when a model has projected properties.

### Recommended: `target()` + `Pick` annotations

When a projection reads a field subset, pass `target()` and derive the annotation with `Pick`:

```typescript
@RelatedOne({ type: 'PLACED_BY', direction: 'out', target: () => Customer, fields: ['customerID', 'companyName', 'country'] })
customer?: Pick<Customer, 'customerID' | 'companyName' | 'country'>
```

With `target()` present, `fields` is type-checked against the target's properties — a typo'd field name is a compile error that lists the valid fields. `Pick` derives the annotation from the same class, so the `fields` list and the DTO shape cannot drift apart: change a property on `Customer` and the compiler points at every projection that needs updating. `fields` without `target()` stays legal (unchecked) — use it when importing the target would be heavy or circular, and keep the annotation honest by hand.

```typescript
import { ProjectionService, projectionNode, hasProjectedProperties, hydrateProjection } from 'neode'

// The service takes (constructor, schema, …) — the facade resolves the schema for you
const service = new ProjectionService(runner)
const learners = await service.get(Learner, schema, { isOptional: true }, limit?, skip?, order?)
const one = await service.find(Learner, schema, primaryKeyValue)
const byId = await service.findById(Learner, schema, elementId)
```

- `projectionNode(alias, schema)` — the RETURN map projection for a model's read query: all properties, the hydration identity markers, full-entity eager relationships and every projected property.
- `hasProjectedProperties(schema)` — true when any property of the model projects a read-model value.
- `hydrateProjection(schema, constructor, projection)` — hydrate one row of a projection read: the projected values land on the entity through the regular hydration switch, then projected kinds (counts, exists, label predicates, expressions, computed) are post-processed.

`ProjectionService` exposes the same match / where surface as the plain query services (`get`/`find`/`findById`); object values on `@RelatedOne` / `@RelatedMany` filter keys traverse to the related node (`{ course: { slug: 'x' } }`).

## Bulk writes & pagination

```typescript
import { BulkService, PaginateService } from 'neode'

await new BulkService(neode.getConnection()).createMany(Person, schema, rows, { chunkSize?: number, database? })
await new PaginateService(neode.getConnection()).paginate(Person, schema, filter, { page: 1, limit: 25 })
```

- `BulkService.createMany(constructor, schema, rows, options?)` — bulk CREATE via UNWIND: one managed write transaction per chunk (default 1000 rows), rows validated and reduced exactly like single `create()`. Nested relationship targets in rows throw.
- `BulkService.mergeMany(...)` — bulk MERGE on the model's merge fields; rows matching an existing node update it (`+=`), the rest are created. Every row must merge on the same merge fields.
- `PaginateService.paginate(constructor, schema, filter, options)` — offset mode (`{ page?, limit, order? }`) returns `Page<T>` = `{ items, total, page, limit, totalPages }` over two autocommit reads; keyset mode (`{ limit, orderBy?, after?, before? }`) walks a temporal property (default `createdAt`) and returns `CursorPage<T>` = `{ items, nextCursor, hasMore }`. Cursors are opaque composites, so rows sharing a property value are never skipped between pages.

Both return `BulkChunk<T>` = `{ count, entities }` per chunk. Prefer the facade wrappers (`neode.createMany`, `neode.mergeMany`, `neode.paginate`) — they resolve the schema for you.

## Factories & seeding

```typescript
import { FactoryBuilder, Seeder, runSeeders, seededRandom } from 'neode'

const users = await neode
  .factory('User')
  .count(10)
  .with('posts', { count: 2, properties: { title: 'Seeded' } })
  .create({ role: 'admin' })

// Unsaved instances (no database round-trip): overrides > default > fake
const drafts = await neode.factory('User').count(3).make({ role: 'admin' })

// Compose another factory: runs per created user, related via the explicit relate path
const people = await neode.factory(Person).has(neode.factory(Pet).count(2), 'pets').create()

// Idempotent seeding: mergeOn matches on rerun instead of duplicating
class RolesSeeder extends Seeder {
  async seed(neode: Neode) {
    await neode.mergeOn(Role, { name: 'admin' }, { description: 'Administrator' })
  }
}

await runSeeders(neode, [new RolesSeeder()])

// Deterministic fakes: same seed, same sequence, reproducible fixtures
const random = seededRandom(42)
```

`neode.factory(model)` returns a chainable `FactoryBuilder`: `.count(n)`, `.with(relationshipName, spec)`, `.has(otherFactory, relationshipName)`, `.make(overrides?)` (unsaved) and `.create(overrides?)` seed fake data through the library's normal create/relate services, so validation, defaults, timestamps and relationship logic all apply. Precedence: explicit value > `default` > `fake`. Unique properties with a `fake` generator are retried until the values are distinct within one batch. `FactoryWithSpec` types one `.with()` call: `{ count, properties? }` — `properties` a static map or a function of the target's index. `.make()` rejects relationship seeding (`.with()` / `.has()`), which needs saved nodes. `.has()` runs the child factory once per created instance and relates every child through `relate()` (MERGE).

`Seeder` is the base class for seeders — implement `seed(neode)` and write with `neode.mergeOn(model, match, set)` / `neode.merge(model, properties)` so reruns update rather than duplicate; `runSeeders(neode, seeders)` runs them in order. `seededRandom(seed)` is a deterministic PRNG for use inside `fake` generators, so fixtures are reproducible across runs.

## Testing & ops

```typescript
import { verifyConnectivity, waitUntilReachable, wipe, testId, splitCypherStatements, runCypherScript } from 'neode'

await verifyConnectivity({ uri: 'bolt://localhost:7687', auth?, config?, database? })
await waitUntilReachable({ uri, … }, { timeout?: 30_000, interval?: 500, check? })
await wipe(neode) // DETACH DELETE everything, then drop all constraints + indexes
const id = testId('person') // 'person-<timestamp>-<random>'
const statements = splitCypherStatements(script) // semicolon-split, comment/string aware
await runCypherScript(runner, script, { onStatement?(statement, index) })
```

- `verifyConnectivity` — check a database is reachable right now, with a throwaway driver (closed again afterwards).
- `waitUntilReachable` — retry with backoff until reachable or the timeout elapses (then: `ConnectivityTimeoutError`).
- `wipe` — wipe the database clean for a test run: DETACH DELETE every node, then drop every constraint and index the database currently has. Standalone on purpose — `installSchema()` derives statements from the registered models, `wipe()` from the database itself. Index drops are best-effort (built-in indexes are ignored).
- `splitCypherStatements` / `runCypherScript` — split a `.cypher` script into statements (semicolons inside strings, backtick identifiers and comments don't split), then run them sequentially, failing fast on the first error.
- `testId(prefix?)` — unique per-run ids, safe as property values, safe for parallel suites.

## Errors

Typed error taxonomy — `classifyError` wraps the raw driver/engine error (preserved as `cause`):

```typescript
import {
  NeodeError,
  ConstraintViolationError,
  TransientError,
  classifyError,
  isTransientError,
} from 'neode'

try {
  await neode.save(user)
} catch (e) {
  if (isTransientError(e)) retry(e) // TransientError: retry may succeed
  if (e instanceof ConstraintViolationError) e.label // parsed from the message when the backend names it
}
```

- `NeodeError` — base class of the taxonomy.
- `ConstraintViolationError` — a unique-constraint violation, raised on `merge()`/`create()` flows that race an existing node; `label`/`property` are set when the database message names them.
- `TransientError` — a transient failure (`Neo.TransientError.*` codes, or the driver's/engine's own `retryable` verdict); `isRetryable` is baked in by the classification.
- `classifyError(error)` — map a raw driver/engine error to the typed taxonomy; unknown shapes and already-typed errors pass through untouched.
- `isTransientError(error)` — type guard for classified transient errors.

## Agent ontology

Emit the live graph schema for grounding Text2Cypher prompts or MCP resources:

```typescript
import { ontology, ontologyMarkdown } from 'neode'

// Ground a Text2Cypher prompt: hand the LLM the live schema, not its
// training-data memory of it.
const systemPrompt = [
  'You write Cypher against the graph described below.',
  '',
  ontologyMarkdown(),
].join('\n')

// Or expose it over MCP as a resource / tool result:
server.resource('graph-ontology', () => ontologyMarkdown())
server.tool('describe-ontology', async () => ({
  content: [{ type: 'text', text: JSON.stringify(ontology()) }],
}))
```

`ontology()` returns `{ entities: EntityOntology[] }` — per entity its labels, description, properties (`PropertyOntology`) and relationships (`RelationshipOntology`). Both are also on the facade as `neode.ontology()` / `neode.ontologyMarkdown()`.
