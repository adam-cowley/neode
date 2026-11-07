# Migrating from neode 0.4.9 to neode 1.0

neode 1.0 is the continuation of neode, rebuilt on modern foundations: `neo4j-driver` 6, Node.js 20+, TypeScript-first, and a database-agnostic connection layer. The concepts are unchanged — models, properties, relationships, validation, eager loading — but the API surface has been tightened and several long-standing bugs are fixed.

This guide covers everything that moved, plus what neode 1.0 gives you that neode never had.

- [Two ways in](#two-ways-in)
- [Installation & connecting](#installation--connecting)
- [IDs: internal ids → elementId](#ids-internal-ids--elementid)
- [Facade signatures: first / relate / deleteAll](#facade-signatures-first--relate--deleteall)
- [Sessions → ConnectionProvider](#sessions--connectionprovider)
- [Validation: Joi rules → Zod, same names](#validation-joi-rules--zod-same-names)
- [batch() and TransactionError](#batch-and-transactionerror)
- [Cascade delete — and detach — now both work](#cascade-delete--and-detach--now-both-work)
- [What's new beyond neode](#whats-new-beyond-neode)
- [Behaviour notes](#behaviour-notes)

## Two ways in

### Path 1 — your existing schemas work as-is

The map-based `model()` / `with()` / `withDirectory()` / `extend()` API is kept for parity. A neode 0.4.9 schema definition is a valid neode 1.0 schema definition — same property type names, same option keys, same shorthand form:

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

Two schema-level differences to know about:

- **`cascade` is not carried per relationship.** neode 1.0 takes cascade as a _delete-time_ option instead — see [Cascade delete](#cascade-delete--and-detach--now-both-work). The `cascade` key in a map schema is accepted but ignored.
- **Relationship `properties` (edge properties) are parsed but not writable yet** — a generated relationship entity is needed for edge-property saves.

### Path 2 — the decorator API

The decorator-first API is the recommended way to write new models: classes with `@NodeEntity`, typed properties, and IDE support. The mapping from neode concepts:

| neode (map)                                                                    | neode 1.0 (decorators)                                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `instance.model('Person', { … })`                                              | `@NodeEntity() class Person { … }`                                                                |
| `person_id: { primary: true, type: 'uuid' }`                                   | `@Uuid({ primary: true }) id: string`                                                             |
| `name: { type: 'string', unique: true }`                                       | `@Property({ type: 'string', unique: true }) name: string`                                        |
| `age: 'number'`                                                                | `@Property({ type: 'number' }) age: number`                                                       |
| internal node id                                                               | `@InternalId() _id: string`                                                                       |
| relationship entry `{ type: 'relationship', relationship, direction, target }` | `@OneToMany(() => Target, 'TYPE', Direction.OUTGOING)` / `@OneToOne({ type, direction, target })` |
| `labels: ['Person', 'Actor']`                                                  | `@NodeEntity({ labels: ['Person', 'Actor'] })`                                                    |
| `extend('Person', 'Actor', { … })`                                             | unchanged — still `neode.extend('Person', 'Actor', { … })`                                        |

Every decorator is listed in the [API reference](api-reference.md#entities--decorators).

## Installation & connecting

```bash
npm install neode@next
```

neode took a Bolt URL and credentials in the constructor. neode 1.0 takes a **ConnectionProvider** — build one with the factories:

```typescript
// neode 0.4.9
const neode = new Neode('bolt://localhost:7687', 'username', 'password', true)
```

```typescript
import neo4j from 'neo4j-driver'
import Neode, { fromEnv } from 'neode'

// Either:
const neode = Neode.forDriver(driver, 'neo4j', true) // database, enterprise
// Or, from NEO4J_* env vars:
const neode2 = fromEnv()
```

Notes:

- The enterprise flag moved out of the constructor's fourth parameter into `setEnterprise(true)`, `NEO4J_ENTERPRISE=true` (for `fromEnv()`), or the factory's `enterprise` argument.
- `NEO4J_KNOWN_HOSTS` and `NEO4J_LOAD_BALANCING_STRATEGY` are ignored with a warning — removed in `neo4j-driver` 6. `NEO4J_TRUST=TRUST_SIGNED_CERTIFICATES` is likewise no longer a valid driver-6 trust strategy.
- No more `neo4j.Integer` anywhere: integers are plain numbers.

## IDs: internal ids → elementId

Neo4j 5+ replaced numeric internal node ids with `elementId` strings, and neode 1.0 follows.

|                                         | neode 0.4.9                     | neode 1.0                                                                       |
| --------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| Look up by internal id                  | `findById('Person', 123)`       | `findById(Person, '4:uuid:0')` — an elementId **string**                        |
| Hydrate the internal id onto the entity | `node.id()` / `node.get('id')`… | declare `@InternalId() _id: string` — hydrated with the elementId on every read |
| Look up by primary key                  | `find('Person', 'uuid-here')`   | unchanged: `neode.find(Person, 'uuid-here')`                                    |

```typescript
@NodeEntity()
class Person {
  @InternalId()
  _id: string // elementId — hydrated by the OGM, never written

  @Uuid({ primary: true })
  id: string // your primary key
}

const saved = await neode.create(Person, { name: 'Adam' })

const byPk = await neode.find(Person, saved.id) // primary key
const byElId = await neode.findById(Person, saved._id) // elementId string
```

## Facade signatures: first / relate / deleteAll

neode's string-labelled facade is now class-based, and a few methods changed shape:

| neode 0.4.9                                                 | neode 1.0                                                                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `first('Person', 'name', 'Adam')`                           | `neode.getFirst(Person, { name: 'Adam' })`                                                                                                |
| `first('Person', { name: 'Adam', age: 29 })`                | `neode.getFirst(Person, { name: 'Adam', age: 29 })`                                                                                       |
| `all('Person', props, order, limit, skip)`                  | `neode.all(Person, props, order, limit, skip)` — same order spec forms (`'name'`, `['name']`, `{ name: 'DESC' }`, …)                      |
| `find('Person', id)` / `findById('Person', id)`             | `neode.find(Person, id)` / `neode.findById(Person, elementId)`                                                                            |
| `create('Person', props)` / `mergeOn('Person', match, set)` | `neode.create(Person, props)` / `neode.mergeOn(Person, match, set)`                                                                       |
| `adam.relateTo(joe, 'knows', { since }, forceCreate)`       | `neode.relate(Person, adam, joe, 'knows', { since }, forceCreate)` — or the instance method `adam.relateTo(joe, 'knows', { since })`      |
| `adam.detachFrom(joe)`                                      | `neode.detach(Person, adam, joe, 'knows')` — or `adam.detachFrom(joe, 'knows')` (the key is required — neode resolved it from the schema) |
| `delete('Person', where)` / `deleteAll('Person')`           | `neode.getRepository(Person).deleteAll(where)` — one `DETACH DELETE`, returns the number deleted                                          |
| `instance.cypher(q, p)`                                     | `neode.readCypher(q, p)` / `neode.writeCypher(q, p)`                                                                                      |

Two changes to the values coming back:

- **`relate` returns a plain relationship shape**, not neode's `Relationship` wrapper: `{ elementId, type, startElementId, endElementId, properties }`.
- **`all()` and `get()` return plain arrays** of hydrated entities, not a `Collection`. (`Collection` is still exported for when you want its `first()`/`toJson()` convenience.)

## Sessions → ConnectionProvider

neode exposed raw driver sessions (`session()`, `readSession()`, `writeSession()`) and an implicit-session `cypher()`. neode 1.0 replaces both with a database-agnostic port: the OGM opens and manages its own transactions through the `ConnectionProvider`, and you talk to it in Cypher or in transactions.

```typescript
// One-off statements (implicit transactions)
await neode.readCypher('MATCH (p:Person) RETURN p LIMIT 10')
await neode.writeCypher('CREATE (p:Person { name: $name }) RETURN p', { name: 'Adam' })

// Explicit transaction — full CRUD surface, you commit or roll back
const tx = await neode.openWriteTransaction()
await tx.save(Person.create('Adam'))
await tx.commit()

// Or a unit of work: rolled back automatically if your callback throws
await neode.inWriteTransaction(async (tx) => {
  const adam = await tx.save(Person.create('Adam'))
  await tx.relate(Person, adam, joe, 'knows', {})
  return adam
})
```

| neode 0.4.9                                               | neode 1.0                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `instance.cypher(q, p)`                                   | `neode.readCypher(q, p)` / `neode.writeCypher(q, p)`                                          |
| `instance.readSession()` / `writeSession()` / `session()` | `neode.readTransaction(db?)` / `writeTransaction(db?)` — or the `open*Transaction()` variants |
| manual session/transaction bookkeeping                    | `inReadTransaction(work)` / `inWriteTransaction(work)` with auto-rollback                     |

Inside a transaction, `tx` (a `TransactionalService`) offers the query surface — `save`, `update`, `delete`, `find`, `findById`, `get`, `getFirst`, `all`, `relate`, `detach`, `withinDistance`, `readCypher`, `writeCypher` — all scoped to the transaction (`create` is facade-only). There are no read/write routing surprises: statements run where you opened the transaction.

## Validation: Joi rules → Zod, same names

neode validated with [Joi](https://github.com/hapijs/joi); neode 1.0 implements **the same rule names over [Zod](https://zod.dev)**, so your rule config ports unchanged. Rules live in the property config, in both definition styles:

```typescript
@Property({ type: 'string', min: 2, max: 50, email: true })
email: string;
```

```typescript
neode.model('Person', {
  email: { type: 'string', min: 2, max: 50, email: true },
})
```

The complete rule list is in the [API reference](api-reference.md#validation-rules) — `min`, `max`, `length`, `regex`, `email`, `ip`, `uri`, `alphanum`, `allow`, `valid`, `invalid`, `positive`, `precision`, `before`/`after`, `lowercase`/`uppercase`, `truncate`, … Unknown rule names throw neode's familiar `Not sure how to validate <rule> on <key>`.

Differences from neode:

- All failing checks for a property are collected (Zod runs every check ≙ Joi's `abortEarly: false`).
- The thrown error carries `.details` — an array of `{ path, message, … }` — and `.input`, mirroring neode's `ValidationError`.
- The `error` option (custom error builder) is not supported.
- `duration` finally has real validation, and `point` checks SRIDs (4326/4979/7203/9157).

Validation runs automatically on every write path (`save`, `create`, `update`), so there is nothing to opt into.

## batch() and TransactionError

`batch()` keeps neode's contract — all statements in **one** transaction, rolled back on failure — with a more honest error:

```typescript
try {
  await neode.batch([
    'CREATE (n:Person { name: "Adam" })',
    { query: 'CREATE (n:Person { name: $name })', params: { name: 'Joe' } },
  ])
} catch (e) {
  // TransactionError:
  //   e.errors   — aligned with the input array, null where a statement succeeded
  //   e.results  — results produced before the failure
  //   e.details  — { index, query, params, error } for every failed statement
}
```

Improvements over neode:

- **Every statement is attempted** before rollback, so the error report covers the whole batch instead of stopping at the first failure.
- `TransactionError` carries the full picture: `errors` aligned with the input array (`null` where a statement succeeded), `results` (partial), and `details` ({ index, query, params, error } per failed statement).
- Statements may be strings or `{ query, params }` objects, as before.

## Cascade delete — and detach — now both work

neode declared cascade behaviour per relationship in the schema (`cascade: 'delete' | 'detach'`), and its `detach` mode was broken. neode 1.0 makes cascade a **delete-time option** that works, for every relationship declared on the model's schema:

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
- The per-relationship `cascade` key from a neode map schema is accepted but ignored — pass the delete options instead.
- `Repository.deleteAll(params)` stays a single bulk `DETACH DELETE` with a count — no cascade, no per-node events.

## What's new beyond neode

- **Lifecycle events.** `neode.on(EventType.NODE_CREATED, handler)` — also `NODE_DELETED`, `RELATIONSHIP_CREATED`, `RELATIONSHIP_MERGED` (more are reserved). `on()`/`off()` chain, and work inside transactions too.
- **Repositories.** `neode.getRepository(Person)` returns a typed `Repository<Person>` with `find`, `findBy`, `findAll`, `where`, `count`, `save`, `saveAll`, `update`, `delete`, `deleteAll`. Subclass and register it with `@EntityRepository(Person)` for domain-specific queries.
- **Active-record instance methods.** Hydrated entities get `save()`, `update()`, `delete()`, `relateTo()`, `detachFrom()` — no need for the `Neode` instance in scope. For TypeScript, type the entity as `WithMethods<Person>`. Your own methods are never clobbered.
- **Multi-backend support.** One OGM, any Cypher-compatible engine: `Neode.forDriver(driver)` for Neo4j (Community/Enterprise/Aura) and Memgraph over Bolt, `Neode.forRelate(db)` for the embedded in-process Relate engine. Multi-database is supported (`setDatabase(db)` + per-call `database` argument) where the server allows it.
- **Capability probing** (test-harness pattern): before running backend-specific tests, probe what the server supports — edition, constraints, temporals, points, multi-database — and skip what it doesn't. See `OGM_TEST_BACKEND=relate|neo4j|memgraph` in the [API reference](api-reference.md#connection-providers).
- **`mergeOn(match, set)`** — MERGE on arbitrary match properties, not just the primary key.
- **Multi-degree eager loading** and `withinDistance(..., order = 'distance')` ordering.

## Behaviour notes

- `save()` MERGEs on the primary key and re-hydrates the entity in place — idempotent for the same unique value.
- `update()` is `+=` semantics: provided keys only, matched by primary key, then re-hydrated.
- When a model declares no primary key, neode 1.0 falls back to `<first label lowercased>_id` — the same default as neode.
- Labels are always sorted and merged on write (`extend()` adds an extra label).
- The query builder (`Builder`) is bundled in-tree — no separate package, and no `neo4j.Integer` coupling.
- `@String` still exists for parity but is deprecated and shadows the global `String` type — prefer `@Property({ type: 'string' })`.
