# Migrating from neode 0.4 to neode 1.0

neode 1.0 is the continuation of neode, rebuilt on modern foundations: `neo4j-driver` 6, Node.js 20+, TypeScript-first, and a database-agnostic connection layer. The concepts are unchanged — models, properties, relationships, validation, eager loading — but the API surface has been tightened and several long-standing bugs are fixed.

This guide covers everything that moved, plus what neode 1.0 gives you that neode never had. Work through the [upgrade checklist](#upgrade-checklist) top to bottom; every step links to the section with the details.

- [Upgrade checklist](#upgrade-checklist)
- [Installation & connecting](#installation--connecting)
- [Two ways to define models](#two-ways-to-define-models)
- [IDs: internal ids → elementId](#ids-internal-ids--elementid)
- [Facade signatures: first / relate / deleteAll](#facade-signatures-first--relate--deleteall)
- [Sessions → transactions](#sessions--transactions)
- [The query builder](#the-query-builder)
- [Collections → plain arrays](#collections--plain-arrays)
- [Validation: Joi rules → Zod, same names](#validation-joi-rules--zod-same-names)
- [runAll() and TransactionError](#runall-and-transactionerror)
- [Cascade delete — and detach — now both work](#cascade-delete--and-detach--now-both-work)
- [Repositories](#repositories)
- [Schema sync: installSchema / dropSchema](#schema-sync-installschema--dropschema)
- [Events](#events)
- [What's new beyond neode](#whats-new-beyond-neode)
- [Behaviour notes](#behaviour-notes)

## Upgrade checklist

1. **Install neode 1.0 and `neo4j-driver` 6** — the driver is now a peer dependency your app owns. → [Installation & connecting](#installation--connecting)
2. **Swap the constructor for `forDriver()` / `fromEnv()`** — the connection-string-plus-credentials constructor is gone. → [Installation & connecting](#installation--connecting)
3. **Register your models** — the map API (`model()` / `with()` / `withDirectory()`) still works; new code can use decorators or `defineModel()`. → [Two ways to define models](#two-ways-to-define-models)
4. **Rename string-label calls to class-based calls** — `neode.first('Person', …)` → `neode.getFirst(Person, …)`, `neode.find('Person', id)` → `neode.find(Person, id)`, and friends. → [Facade signatures](#facade-signatures-first--relate--deleteall)
5. **Replace session usage with transactions** — `session()` / `readSession()` / `writeSession()` / `transaction()` are gone; the OGM manages its own transactions. → [Sessions → transactions](#sessions--transactions)
6. **Port `neode.query()` call sites** — the builder is now a standalone `Builder` class you build and run yourself. → [The query builder](#the-query-builder)
7. **Expect plain arrays** instead of `Collection` from `all()` / `get()`. → [Collections → plain arrays](#collections--plain-arrays)
8. **Review error handling** — validation rules keep their Joi names over Zod, and `runAll()` reports every failed statement. → [Validation](#validation-joi-rules--zod-same-names), [runAll() and TransactionError](#runall-and-transactionerror)
9. **Review cascade deletes** — the schema-level `cascade: true` annotation cascades that relationship on every delete; `{ cascade: true }` on the delete call still takes everything. → [Cascade delete](#cascade-delete--and-detach--now-both-work)
10. **Switch ids to elementId** — numeric internal node ids no longer exist on Neo4j 5+. → [IDs: internal ids → elementId](#ids-internal-ids--elementid)
11. **Install constraints and indexes at boot** — `installSchema()` is new (0.4 never created them for you). → [Schema sync](#schema-sync-installschema--dropschema)

## Installation & connecting

The dist-tag for the 1.0 line is decided at release time — check the release notes; the examples below assume the package is installed:

```sh
npm install neode
npm install neo4j-driver@^6
```

neode took a Bolt URL and credentials in the constructor. neode 1.0 takes a **ConnectionProvider** — build one with the factories:

```typescript
// neode 0.4.9
const neode = new Neode('bolt://localhost:7687', 'neo4j', 'password', true, 'neo4j')
```

```typescript
import neo4j from 'neo4j-driver'
import { Neode } from 'neode'

const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'password'))
const neode = Neode.forDriver(driver, 'neo4j', true) // database, enterprise
```

or from `NEO4J_*` environment variables:

```typescript
import { fromEnv } from 'neode'

const neode = fromEnv()
```

Notes:

- The enterprise flag moved out of the constructor's fourth parameter into `setEnterprise(true)`, `NEO4J_ENTERPRISE=true` (for `fromEnv()`), or the factory's `enterprise` argument.
- `NEO4J_KNOWN_HOSTS` and `NEO4J_LOAD_BALANCING_STRATEGY` are ignored with a warning — removed in `neo4j-driver` 6. `NEO4J_TRUST=TRUST_SIGNED_CERTIFICATES` is likewise no longer a valid driver-6 trust strategy.
- No more `neo4j.Integer` anywhere: integers are plain numbers.
- `neode.close()` closes the underlying connection, as before.

## Two ways to define models

### Path 1 — your existing schemas work as-is

The map-based `model()` / `with()` / `withDirectory()` / `extend()` API is kept for parity. A neode 0.4 schema definition is a valid neode 1.0 schema definition — same property type names, same option keys, same shorthand form:

```typescript
neode.model('Person', {
  person_id: { primary: true, type: 'uuid' },
  name: { type: 'string', unique: true },
  age: 'number',
  acts_in: {
    type: 'relationship',
    relationship: 'ACTS_IN',
    direction: 'out',
    target: 'Movie',
    eager: true,
  },
})
```

The standalone `defineModel()` function registers the same definitions without an instance (handy for tooling and tests), and the two batch forms survive:

```typescript
import { defineModel } from 'neode'

const Person = defineModel('Person', {
  person_id: { primary: true, type: 'uuid' },
  name: { type: 'string', unique: true },
  age: 'number',
})
```

```typescript
neode.with({ Movie: { title: 'string' }, Person: { name: 'string' } })
neode.withDirectory('./models') // model modules, name from filename
```

`withDirectory()` still scans a directory of model modules and names each model after its file — it now also picks up `.ts` files and prefers a module's `default` export. One caveat: it loads files with `require()`, so ESM-only `.ts` model files need a runtime that can require them.

Two schema-level differences to know about:

- **`cascade: 'delete' | 'detach'` becomes `cascade: true`.** The annotation is carried per relationship again: a plain delete cascades every relationship declared `cascade: true`, and `{ cascade: true }` on the delete call takes every relationship on the schema — see [Cascade delete](#cascade-delete--and-detach--now-both-work).
- **Relationship `properties` (edge properties) are parsed but not writable yet** — a generated relationship entity is needed for edge-property saves.

### Path 2 — the decorator API

The decorator-first API is the recommended way to write new models: classes with `@NodeEntity`, typed properties, and IDE support. The mapping from neode concepts:

| neode (map)                                                                    | neode 1.0 (decorators)                                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `instance.model('Person', { … })`                                              | `@NodeEntity() class Person { … }`                                                                |
| `person_id: { primary: true, type: 'uuid' }`                                   | `@Uuid({ primary: true }) person_id: string`                                                      |
| `name: { type: 'string', unique: true }`                                       | `@Property({ type: 'string', unique: true }) name: string`                                        |
| `age: 'number'`                                                                | `@Property({ type: 'number' }) age: number`                                                       |
| internal node id                                                               | `@InternalId() _id: string`                                                                       |
| relationship entry `{ type: 'relationship', relationship, direction, target }` | `@OneToMany(() => Target, 'TYPE', Direction.OUTGOING)` / `@OneToOne({ type, direction, target })` |
| `labels: ['Person', 'Actor']`                                                  | `@NodeEntity({ labels: ['Person', 'Actor'] })`                                                    |
| `extend('Person', 'Actor', { … })`                                             | unchanged — still `neode.extend('Person', 'Actor', { … })`                                        |

```typescript
import { Direction, InternalId, NodeEntity, OneToMany, Property, Uuid } from 'neode'

@NodeEntity()
class Person {
  @InternalId()
  _id!: string // elementId, hydrated on read — never written

  @Uuid({ primary: true })
  person_id!: string

  @Property({ type: 'string', unique: true })
  name!: string

  @Property({ type: 'number' })
  age!: number

  @OneToMany(() => Movie, 'ACTED_IN', Direction.OUTGOING)
  actsIn!: Movie[]
}
```

Three TypeScript notes that did not apply to neode:

- Decorators are the language's **standard TC39 decorators** — no `experimentalDecorators`, no `reflect-metadata`. Relationship decorators take the target explicitly (`() => Movie`), because `design:type` reflection is gone.
- Declared fields need `!` when they have no initializer (`name!: string`) — decorator-populated fields are still assigned by the OGM.
- Relationship decorators require a class decorator (`@NodeEntity()` / `@RelationshipEntity()`) on the class to run.

Every decorator is listed in the [API reference](api-reference.md#entities--decorators).

## IDs: internal ids → elementId

Neo4j 5+ replaced numeric internal node ids with `elementId` strings, and neode 1.0 follows.

|                                         | neode 0.4                       | neode 1.0                                                                       |
| --------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| Look up by internal id                  | `findById('Person', 123)`       | `findById(Person, '4:uuid:0')` — an elementId **string**                        |
| Hydrate the internal id onto the entity | `node.id()` / `node.get('id')`… | declare `@InternalId() _id: string` — hydrated with the elementId on every read |
| Look up by primary key                  | `find('Person', 'uuid-here')`   | unchanged: `neode.find(Person, 'uuid-here')`                                    |

```typescript
const saved = await neode.create(Person, { name: 'Adam' })

const byPk = await neode.find(Person, saved.person_id) // primary key
const byElementId = await neode.findById(Person, saved._id) // elementId string
```

## Facade signatures: first / relate / deleteAll

neode's string-labelled facade is now class-based, and a few methods changed shape:

| neode 0.4                                                   | neode 1.0                                                                                                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `first('Person', 'name', 'Adam')`                           | `neode.getFirst(Person, { name: 'Adam' })` or `neode.first(Person, 'name', 'Adam')`                                                             |
| `first('Person', { name: 'Adam', age: 29 })`                | `neode.getFirst(Person, { name: 'Adam', age: 29 })`                                                                                             |
| `all('Person', props, order, limit, skip)`                  | `neode.all(Person, props, order, limit, skip)` — same order spec forms (`'name'`, `['name']`, `{ name: 'DESC' }`, …)                            |
| `find('Person', id)` / `findById('Person', id)`             | `neode.find(Person, id)` / `neode.findById(Person, elementId)`                                                                                  |
| `create('Person', props)` / `mergeOn('Person', match, set)` | `neode.create(Person, props)` / `neode.mergeOn(Person, match, set)`                                                                             |
| `adam.relateTo(joe, 'knows', { since }, forceCreate)`       | `neode.relate(Person, adam, joe, 'knows', { since }, forceCreate)` — or the instance method `adam.relateTo(joe, 'knows', { since })`            |
| `adam.detachFrom(joe)`                                      | `neode.detach(Person, adam, joe, 'knows')` — or `adam.detachFrom(joe, 'knows')` (the key is required — neode resolved it from the schema)       |
| `delete('Person', where)` / `deleteAll('Person')`           | `neode.getRepository(Person).deleteAll(where)` — one `DETACH DELETE`, returns the number deleted                                                |
| `instance.cypher(q, p)`                                     | `neode.readCypher(q, p)` / `neode.writeCypher(q, p)`, or the unified `neode.cypher(q, p)` (READ by default; `{ routing: 'WRITE' }` to override) |

```typescript
const adam = await neode.getFirst(Person, { name: 'Adam' })
const movie = await neode.getFirst(Movie, { title: 'The Matrix' })

await neode.relate(Person, adam, movie, 'actsIn', { role: 'Neo' })
await neode.detach(Person, adam, movie, 'actsIn')
```

Two changes to the values coming back:

- **`relate` returns a plain relationship shape**, not neode's `Relationship` wrapper: `{ elementId, type, startElementId, endElementId, properties }`.
- **`all()` and `get()` return plain arrays** of hydrated entities, not a `Collection`. (`Collection` is still exported for when you want its `first()`/`toJson()` convenience — see [Collections](#collections--plain-arrays).)

## Sessions → transactions

neode exposed raw driver sessions (`session()`, `readSession()`, `writeSession()`) and an implicit-session `cypher()`. neode 1.0 replaces both with a database-agnostic port: the OGM opens and manages its own transactions through the `ConnectionProvider`, and you talk to it in Cypher or in transactions.

```typescript
// neode 0.4.9
const session = neode.readSession()
const result = await session.executeRead((tx) => tx.run('MATCH (p:Person) RETURN p LIMIT 10'))
await session.close()

const tx = neode.transaction()
await tx.run('CREATE (p:Person { name: $name })', { name: 'Adam' })
await tx.success() // commit + close
```

```typescript
// One-off statements (implicit transactions)
const output = await neode.cypher('MATCH (p:Person) RETURN p LIMIT 10')
await neode.writeCypher('CREATE (p:Person { name: $name })', { name: 'Adam' })
```

```typescript
// Unit of work: rolled back automatically if your callback throws
await neode.inWriteTransaction(async (tx) => {
  const adam = new Person()
  adam.name = 'Adam'
  await tx.save(adam)

  await tx.cypher('MATCH (p:Person { name: $name }) SET p.age = $age', {
    name: 'Adam',
    age: 29,
  })

  return adam
})
```

```typescript
// Explicit handle: you commit or roll back
const tx = await neode.openWriteTransaction()

try {
  await tx.writeCypher('CREATE (p:Person { name: $name })', { name: 'Adam' })
  await tx.commit()
} catch (error) {
  await tx.rollback()
  throw error
}
```

| neode 0.4                                                 | neode 1.0                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `instance.cypher(q, p)`                                   | `neode.readCypher(q, p)` / `neode.writeCypher(q, p)` / `neode.cypher(q, p)`                   |
| `instance.readSession()` / `writeSession()` / `session()` | `neode.readTransaction(db?)` / `writeTransaction(db?)` — or the `open*Transaction()` variants |
| `instance.transaction(mode, db)` + `tx.success()`         | `openReadTransaction()` / `openWriteTransaction()` — `tx.commit()` / `tx.rollback()`          |
| manual session/transaction bookkeeping                    | `inReadTransaction(work)` / `inWriteTransaction(work)` with auto-rollback                     |

Inside a transaction, `tx` (a `TransactionalService`) offers the full query surface — `save`, `update`, `delete`, `find`, `findById`, `get`, `getFirst`, `all`, `relate`, `detach`, `withinDistance`, `cypher`, `readCypher`, `writeCypher` — all scoped to the transaction (`create` and `mergeOn` are facade-only). `tx` implements the same `INeode` port the facade does, so code written against `INeode` — a repository, a helper — runs unchanged inside a transaction. There are no read/write routing surprises: statements run where you opened the transaction.

To construct entities inside a transaction, `new` them and `save()` — MERGE on the primary key (uuid defaults generate on write).

## The query builder

neode 0.4 handed you a builder bound to the instance (`neode.query()`), and `execute()` ran it against that instance's driver. neode 1.0 ships a standalone, statement-based `Builder`: it composes a query plus parameters, and **you** choose how to run it — the facade's Cypher methods, or `execute(runner)`.

```typescript
// neode 0.4.9
const people = await neode
  .query()
  .match('this', 'Person')
  .where('this.age', 29)
  .return('this')
  .execute()
```

```typescript
import { Builder } from 'neode'

const { query, params } = new Builder()
  .match('this', 'Person')
  .where('this.age', 29)
  .return('this')
  .build()

const output = await neode.writeCypher(query, params)
```

or execute it directly against the instance's connection (or any `Runner`, including an open transaction):

```typescript
const output = await new Builder()
  .match('this', 'Person')
  .where('this.age', 29)
  .return('this')
  .execute(neode.getConnection(), 'READ')
```

The fluent surface you know carries over — `match()`, `optionalMatch()`, `where()` (and `whereId`, `whereRaw`, `whereBetween`, `whereNot`, `or`), `create()`, `merge()`, `set()`, `onCreateSet()`, `onMatchSet()`, `delete()`, `detachDelete()`, `remove()`, `return()`, `orderBy()`, `limit()`, `skip()`, `with()`, `relationship()` — plus new predicates (`whereIn`, `whereContains`, `whereStartsWith`, `whereEndsWith`, `whereNull`, `whereExists`, `whereNotPattern`, `whereLabel`, `whereGroup`). All values are passed as query parameters — the generated query contains only aliases.

What moved:

- The builder no longer takes the neode instance — `new Builder()` instead of `neode.query()`.
- `build()` returns `{ query, params }`; nothing runs until you run it (`writeCypher` / `readCypher`, or `execute(runner, mode?)` with `neode.getConnection()` or a transaction's runner).
- Every `match()` / `create()` / `merge()` starts a new statement segment; `where` clauses accumulate against the current segment. Chaining a `match` after a `create`/`merge` bridges with `WITH *` for you.

## Collections → plain arrays

`all()` and `get()` return plain arrays of hydrated entities — use array methods directly:

```typescript
// neode 0.4.9
const people = await neode.all('Person')
const first = people.first()
const json = people.toJson()
```

```typescript
const people = await neode.all(Person, {}, 'name')
const first = people[0]
for (const person of people) {
  console.log(person.name)
}
```

```typescript
import { toJson } from 'neode'

const json = toJson(first)
```

| neode 0.4 (`Collection`)      | neode 1.0                                           |
| ----------------------------- | --------------------------------------------------- |
| `collection.length`           | `array.length`                                      |
| `collection.get(i)`           | `array[i]`                                          |
| `collection.first()`          | `array[0]`                                          |
| `collection.map/find/forEach` | `array.map/find/forEach`                            |
| `collection.toJson()`         | `toJson(entity)` per entity, or `array.map(toJson)` |
| iteration (`for…of`)          | unchanged — plain arrays iterate                    |

The `Collection` wrapper is still exported (`Collection.from(iterable)`, `length`, `get`, `first`, `map`, `find`, `forEach`) and `toCollection()` hydrates a raw result into one, if you want the neode shapes back.

## Validation: Joi rules → Zod, same names

neode validated with [Joi](https://github.com/hapijs/joi); neode 1.0 implements **the same rule names over [Zod](https://zod.dev)**, so your rule config ports unchanged. Rules live in the property config, in both definition styles — for example, as a decorator:

```typescript
@Property({ type: 'string', min: 2, max: 50, email: true })
email!: string
```

The same keys are accepted in map-based definitions (`neode.model('Person', { email: { type: 'string', min: 2, max: 50, email: true } })`) — the rule keys are part of the published `SchemaDefinition` types, so the map API gets the same autocomplete and type errors as the decorators.

The complete rule list is in the [API reference](api-reference.md#validation-rules) — `min`, `max`, `length`, `regex`, `email`, `ip`, `uri`, `alphanum`, `allow`, `valid`, `invalid`, `positive`, `precision`, `before`/`after`, `lowercase`/`uppercase`, `truncate`, … Unknown rule names throw neode's familiar `Not sure how to validate <rule> on <key>`.

Validation runs automatically on every write path (`save`, `create`, `update`) and throws a `ValidationError` — the port of neode's error, with the same `.details` / `.input` shape:

```typescript
import { ValidationError } from 'neode'

try {
  await neode.create(Person, { name: 'A', email: 'not-an-email' })
} catch (error) {
  if (error instanceof ValidationError) {
    // error.details — one { path, message, type } entry per failed check
    // error.input   — the object that failed
    console.warn(error.message)
  }
}
```

Differences from neode:

- All failing checks for a property are collected (Zod runs every check ≙ Joi's `abortEarly: false`).
- The `error` option (custom error builder) is not supported.
- `duration` finally has real validation, and `point` checks SRIDs (4326/4979/7203/9157).

## runAll() and TransactionError

`runAll()` — neode's `batch()`, renamed (NTS-624): the statements run sequentially and the ONE transaction is the point, so the name no longer suggests a throughput feature — keeps neode's contract, all statements in **one** transaction, rolled back on failure, with a more honest error:

```typescript
import { TransactionError } from 'neode'

try {
  const results = await neode.runAll([
    'CREATE (n:Person { name: "Adam" })',
    { query: 'CREATE (n:Person { name: $name })', params: { name: 'Joe' } },
  ])
  console.log(results.length)
} catch (error) {
  if (error instanceof TransactionError) {
    // error.errors  — aligned with the input array, null where a statement succeeded
    // error.results — results produced before the failure
    // error.details — { index, query, params, error } for every failed statement
    console.warn(error.message)
  }
}
```

Improvements over neode:

- **Every statement is attempted** before rollback, so the error report covers the whole batch instead of stopping at the first failure.
- `TransactionError` carries the full picture: `errors` aligned with the input array (`null` where a statement succeeded), `results` (partial), and `details` ({ index, query, params, error } per failed statement).
- Statements may be strings or `{ query, params }` objects, as before.

## Cascade delete — and detach — now both work

neode declared cascade behaviour per relationship in the schema (`cascade: 'delete' | 'detach'`), and its `detach` mode was broken. neode 1.0 makes cascade a **delete-time option** that works, for every relationship declared on the model's schema:

```typescript
// neode 0.4.9
await adam.delete() // deleted to depth 10 by default, per-relationship cascade in the schema
```

```typescript
await neode.delete(adam) // plain DETACH DELETE — related nodes untouched

await neode.delete(adam, {
  cascade: true, // cascade into every relationship on the schema
  mode: 'delete', // default: delete related nodes recursively
  depth: 10, // max hops, this is the default
})

await neode.delete(adam, {
  cascade: true,
  mode: 'detach', // remove the relationships, KEEP the related nodes
})
```

- The instance method works too: `await adam.delete({ cascade: true, mode: 'detach' })`.
- **Per-relationship cascade is declared on the schema again, as `cascade: true`** (neode 0.x's `cascade: 'delete' | 'detach'` spellings need converting): a plain delete cascades only the annotated relationships, recursively, each level applying its own annotations. `{ cascade: true }` on the delete call overrides the annotations and takes every relationship; `{ cascade: false }` takes none.

  ```typescript
  const factorySchema = {
    id: { type: 'uuid', primary: true },
    lines: {
      type: 'relationships',
      relationship: 'HAS',
      direction: 'out',
      target: 'AssemblyLine',
      cascade: true,
    },
    warehouse: {
      type: 'relationship',
      relationship: 'HAS',
      direction: 'out',
      target: 'Warehouse',
    },
  }

  await neode.delete(factory) // assembly lines (and their machines, …) deleted; the warehouse survives
  await neode.delete(factory, { cascade: true }) // everything, the warehouse too
  ```
- A soft delete is available: `neode.delete(adam, { soft: 'Deleted' })` sets a `Deleted` label instead of deleting.
- `Repository.deleteAll(params)` stays a single bulk `DETACH DELETE` with a count — no cascade, no per-node events.

## Repositories

`neode.getRepository(Person)` returns a typed `Repository<Person>` — the home for query logic that used to live next to your models:

```typescript
const people = neode.getRepository(Person)

const adam = await people.find('person-uuid')
if (adam) {
  await people.patch(adam, { age: 30 }) // 0.4-style repositories called this update()
  await people.increment(adam, 'age', 2) // atomic +=, returns the new value
  await people.delete(adam, { ifExists: true }) // no-op when the row is already gone
}
const byAge = await people.countBy('age') // { '29': 3, '30': 1 }
const total = await people.count({ name: 'Adam' })
const deleted = await people.deleteAll({ age: 29 }) // one bulk DETACH DELETE → count
```

Method notes for neode users:

- **`patch(entity, properties)`**, not `update` — `update()` on the facade and on entity instances keeps neode's `+=` semantics, but the repository method is named `patch` so subclasses can define their own `update(id, input)`.
- **`delete(entityOrId, { ifExists: true })`** — accepts an entity instance or a primary key value; the default throws when the id is missing, `ifExists` silently no-ops.
- **`increment(entityOrId, property, by?, { ifExists?, min? })`** — one server-side `SET n.prop = coalesce(n.prop, 0) + by`, safe under concurrency; returns the new value. `min` (NTS-655) checks a floor in the same statement, under the write lock — a post-write value below it throws `GuardViolationError` (run guarded decrements inside a managed transaction so the violation rolls back).
- **`countBy(property, params?)`** — grouped counts over one declared property.
- `find(id)`, `findBy(params)`, `findAll(params, { order, limit, skip })`, `where(params)`, `count(params)`, `save(entity)`, `saveAll(entities)` round out the surface.

Custom repositories — subclass `Repository<Entity>` and register it with `@EntityRepository(Person)`; `getRepository(Person)` then resolves your subclass, and the subclass sees the full protected surface (`neode`, `entity`, `schema`) plus `find`/`findAll`/`save`/… for domain queries. See the [API reference](api-reference.md#custom-repositories) for the full example.

## Schema sync: installSchema / dropSchema

neode never created constraints or indexes for you; you ran them by hand or with a migration tool. neode 1.0 installs the schema declared by your models — `unique`, `index`, `required`/`exists` constraints, full-text and vector indexes — with idempotent Cypher and deterministic names, and `dropSchema()` reverses it exactly:

```typescript
await neode.installSchema() // create constraints + indexes declared by the models
await neode.dropSchema() // drop them again — deterministic, so the round-trip is exact
```

To audit an existing database against your models instead of blindly creating:

```typescript
const diff = await neode.schemaDiff()
console.log(neode.formatSchemaDiff(diff)) // human-readable missing / stale / mismatched report
```

## Events

neode 1.0 emits lifecycle events on an emitter scoped to the instance — including for work performed inside transactions:

```typescript
import { EventType } from 'neode'

neode.on(EventType.NODE_CREATED, (entity) => {
  console.log('created:', entity)
})

neode.on(EventType.QUERY_EXECUTED, (event) => {
  console.log('query executed:', event)
})
```

Available: `NODE_CREATED`, `NODE_UPDATED`, `NODE_DELETED`, `RELATIONSHIP_CREATED`, `RELATIONSHIP_MERGED` (more are reserved) and `QUERY_EXECUTED` for every statement the instance runs. `neode.on()` returns the instance for chaining; `neode.off()` unsubscribes.

## What's new beyond neode

- **Repositories** — see [Repositories](#repositories).
- **Schema sync** — `installSchema()` / `dropSchema()` / drift reporting — see [Schema sync](#schema-sync-installschema--dropschema).
- **Lifecycle events** — see [Events](#events).
- **Multi-backend support.** One OGM, any Cypher-compatible engine: `Neode.forDriver(driver)` for Neo4j (Community/Enterprise/Aura) and Memgraph over Bolt, `Neode.forRelate(db)` for the embedded in-process Relate engine. Multi-database is supported (`setDatabase(db)` + per-call `database` argument) where the server allows it.
- **Capability probing** (test-harness pattern): before running backend-specific tests, probe what the server supports — edition, constraints, temporals, points, multi-database — and skip what it doesn't. See `OGM_TEST_BACKEND=relate|neo4j|memgraph` in the [API reference](api-reference.md#connection-providers).
- **`mergeOn(match, set)`** — MERGE on arbitrary match properties, not just the primary key.
- **Multi-degree eager loading** and `withinDistance(..., order = 'distance')` ordering.
- **Pagination** — offset (`{ page, limit, order }`) and keyset (`{ limit, orderBy, after }`) helpers over any model.
- **Agent-readable ontology** — `neode.ontology()` / `neode.ontologyMarkdown()` emit the live graph schema for Text2Cypher grounding.

## Behaviour notes

- `save()` MERGEs on the primary key and re-hydrates the entity in place — idempotent for the same unique value.
- `update()` is `+=` semantics: provided keys only, matched by primary key, then re-hydrated.
- When a model declares no primary key, neode 1.0 falls back to `<first label lowercased>_id` — the same default as neode.
- Labels are always sorted and merged on write (`extend()` adds an extra label).
- The query builder (`Builder`) is bundled in-tree — no separate package, and no `neo4j.Integer` coupling.
- `@String` still exists for parity but is deprecated and shadows the global `String` type — prefer `@Property({ type: 'string' })`.
- Error messages are richer: missing-model errors name the registered models; hydration failures name the model and property.
- Integer values beyond `Number.MAX_SAFE_INTEGER` are rejected instead of silently losing precision.
- Out-transforms are sync-only: an async `out` transform is rejected at hydration.
