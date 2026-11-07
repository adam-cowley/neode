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
  // Types
  type EntityMethods,
  type WithMethods,
  type PropertyTypeName,
  type PropertyDefinition,
  type RelationshipDefinition,
  type SchemaDefinition,
  type SchemaDefinitionEntry,
  type ConnectionProvider,
  type TransactionHandle,
  type Runner,
  type QueryOutput,
  type QueryRecord,
  type QueryParams,
  type GraphNode,
  type GraphRelationship,
  type AccessMode,
  type RepositoryConstructor,
} from 'neode'
```

- [Entities & decorators](#entities--decorators)
- [Validation rules](#validation-rules)
- [Map-based schema definitions](#map-based-schema-definitions)
- [The Neode facade](#the-neode-facade)
- [Transactions](#transactions)
- [Events](#events)
- [Repositories](#repositories)
- [Schema sync](#schema-sync)
- [Connection providers](#connection-providers)
- [Instance methods](#instance-methods)
- [Collection & serialisation](#collection--serialisation)

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

| Option            | Meaning                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `type`            | Property type name (see table above).                                                    |
| `array`           | Store as an array.                                                                       |
| `primary`         | Primary key — the MERGE key for `save()`.                                                |
| `unique`          | Unique constraint (created by `installSchema()`); unique values are always SET on merge. |
| `index`           | Index (created by `installSchema()`).                                                    |
| `required`        | Required property — existence constraint in Enterprise mode.                             |
| `exists`          | Property existence constraint (Enterprise only).                                         |
| `default`         | Value or `(model, schema) => value`, resolved on create.                                 |
| `onCreateSet`     | SET only on CREATE.                                                                      |
| `onMatchSet`      | SET only on MATCH.                                                                       |
| `alwaysSet`       | SET on every write.                                                                      |
| `readonly`        | Excluded from `update()` writes.                                                         |
| `hidden`          | Excluded from `toJson()` output.                                                         |
| `protected`       | Excluded from hydration input.                                                           |
| _(any other key)_ | Treated as a validation rule — see [Validation rules](#validation-rules).                |

### Property option decorators

Each applies the matching config option to the property it decorates:

`@Default(valueOrFn)` · `@OnCreateSet()` · `@OnMatchSet()` · `@Index()` · `@Unique()` · `@Required()` · `@Hidden()` · `@Protected()` · `@Readonly()` · `@Primary(config?)`

`@Primary` marks the property as primary key; combine it with a type decorator (or use `@Uuid({ primary: true })`).

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
- **Relationship entries** take `relationship`, `direction`, `target`, `eager?`. A `properties` key is parsed but edge properties are not writable yet. A `cascade` key is accepted but ignored — pass [delete options](#the-neode-facade) instead.
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
// Plain DETACH DELETE; with options, cascades:
//   { cascade: true }                        — delete related nodes recursively
//   { cascade: true, mode: 'detach' }        — remove relationships, keep nodes
//   { cascade: true, depth: 10 }             — cap recursion (default 10)
// Legacy form delete(entity, database) — string second arg — still accepted.

neode.withinDistance<T>(constructor, locationProperty, point, distance, params?, order?, limit?, skip?, database?): Promise<T[]>
// order: 'distance' orders by distance from the point.
```

Most of this surface is also available on hydrated entities as [instance methods](#instance-methods), and inside transactions (below).

### Cypher and batches

```typescript
neode.readCypher(query: string, params?: QueryParams, database?): Promise<QueryOutput>
neode.writeCypher(query: string, params?: QueryParams, database?): Promise<QueryOutput>
neode.batch(queries: Array<string | { query: string; params?: QueryParams }>, database?): Promise<QueryOutput[]>
// All statements in ONE write transaction; every statement is attempted,
// then rolled back on any failure (see Transactions).
```

`QueryOutput` is `{ records: QueryRecord[]; summary? }`; a `QueryRecord` offers `get(key)`, `has(key)`, `keys`.

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

| Method          | Signature                                                             | Description                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `find`          | `(id) => Promise<Entity \| undefined>`                                | By primary key.                                                                                                                                                      |
| `findBy`        | `(params?) => Promise<Entity \| undefined>`                           | First match.                                                                                                                                                         |
| `findAll`       | `(params?, options?: { order?, limit?, skip? }) => Promise<Entity[]>` | `order` takes the same `OrderSpec` forms as `all()`.                                                                                                                 |
| `where`         | `(params?) => Promise<Entity[]>`                                      | Alias of `findAll(params)`.                                                                                                                                          |
| `count`         | `(params?) => Promise<number>`                                        |                                                                                                                                                                      |
| `save`          | `(object) => Promise<Entity>`                                         | MERGE on primary key.                                                                                                                                                |
| `saveAll`       | `(objects) => Promise<Entity[]>`                                      | One save (one write transaction) at a time.                                                                                                                          |
| `patch`         | `(entity, properties) => Promise<Entity>`                             | Apply a patch, then persist via save. Named `patch` so domain interfaces declaring their own `update(id, input)` can be implemented by subclasses (NTS-454/458/459). |
| `delete`        | `(entityOrId, { ifExists? }) => Promise<void>`                        | By instance or primary key value. Throws on a missing ID; `{ ifExists: true }` silently no-ops (NTS-457).                                                            |
| `increment`     | `(entityOrId, property, by?, { ifExists? }) => Promise<number>`       | Atomic `SET n.prop = coalesce(n.prop, 0) + by` (NTS-435). Returns the new value, or 0 when missing with `ifExists` (NTS-455).                                        |
| `countBy`       | `(property, params?) => Promise<Record<string, number>>`              | Grouped counts over one declared property (NTS-453).                                                                                                                 |
| `deleteAll`     | `(params?) => Promise<number>`                                        | One bulk `DETACH DELETE` of every match; returns the count. No cascade, no per-node events.                                                                          |
| `getPrimaryKey` | `() => PropertySchema`                                                |                                                                                                                                                                      |

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

## Instance methods

Hydrated entities get active-record methods on their prototype (wired once per class at first hydration):

```typescript
interface EntityMethods {
  save(): Promise<this> // MERGE, re-hydrate
  update(properties?: Record<string, unknown>): Promise<this> // `+=`, re-hydrate
  delete(options?: { cascade?; mode?; depth? } | string): Promise<void>
  relateTo<To extends object>(
    other: To,
    relationshipKey: string,
    properties?,
    forceCreate?,
  ): Promise<GraphRelationship | undefined>
  detachFrom<To extends object>(other: To, relationshipKey: string): Promise<{ from; to }>
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
