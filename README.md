# neode

neode is a Neo4j OGM for Node.js designed to take care of the CRUD boilerplate involved with setting up a graph database project. Just install, define your models and go.

It runs against any Cypher-compatible engine: **Neo4j** (Community, Enterprise, Aura) and **Memgraph** over Bolt, or the embedded [Relate](https://github.com/relateapp/relate) engine in-process.

- [Getting Started](#getting-started)
- [Quick Start (decorators)](#quick-start-decorators)
- [The Map-Based API](#the-map-based-api)
- [Validation](#validation)
- [Schema](#schema)
- [Docs](#docs)

Coming from [neode](https://github.com/adam-cowley/neode) 0.4.9? Your existing map-based schemas keep working — read the [migration guide](docs/migration-guide.md).

> **1.0 alpha.** This branch is the `1.0.0-alpha.0` prerelease line. Install it with the `next` dist-tag — `npm install neode` still gives you 0.4.9 until 1.0 goes stable.

## Getting Started

### Installation

```bash
npm install neode@next
```

Requires Node.js 20 or newer (Neo4j 5.x / 2025.x servers, `neo4j-driver` 6).

### Connecting

```typescript
// index.ts
import neo4j from 'neo4j-driver'
import Neode from 'neode'

const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'password'))

const neode = Neode.forDriver(driver)
```

Or connect from `.env` variables:

```bash
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=neo4j
NEO4J_DATABASE=neo4j
```

```typescript
import { fromEnv } from 'neode'

const neode = fromEnv()
```

`fromEnv()` supports the full set of `NEO4J_*` variables (protocol/host/port, credentials, database, enterprise flag, encryption, trust, pool sizing, logging) — see the [API reference](docs/api-reference.md#connection-providers). To run the OGM over an embedded in-process Cypher engine instead of Bolt, use `Neode.forRelate(database)`.

## Quick Start (decorators)

Models are classes decorated with `@NodeEntity`. Property types and options — including validation rules — live in the decorator config:

```typescript
import {
  NodeEntity,
  Uuid,
  Property,
  InternalId,
  OneToMany,
  Direction,
  WithMethods,
} from 'neode'

@NodeEntity()
export class Pet {
  @InternalId() // hydrated with the node's elementId
  _id: string

  @Uuid({ primary: true }) // auto-generated UUID primary key
  id: string

  @Property({ type: 'string', unique: true })
  name: string
}

@NodeEntity()
export class Person {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string

  @Property({ type: 'number' })
  age: number

  @OneToMany(() => Pet, 'OWNS', Direction.OUTGOING, true) // eager-loaded
  pets: Pet[]
}
```

Create, read, update, delete and relate:

```typescript
// Create — nested relationship targets are written too
const adam = await neode.create(Person, { name: 'Adam', age: 30 })
const rex = await neode.create(Pet, { name: 'Rex' })

// Or MERGE-save an instance (merges on the primary key, then re-hydrates)
const joe = new Person()
joe.name = 'Joe'
const savedJoe = await neode.save(joe)

// Find by primary key — or by elementId
const found = await neode.find(Person, adam.id)
const byElementId = await neode.findById(Person, adam._id)

// Query
const named = await neode.get(Person, { name: 'Adam' }) // list
const first = await neode.getFirst(Person, { name: 'Adam' }) // one or undefined
const all = await neode.all(Person, {}, 'name', 10, 0) // order, limit, skip

// Update — `+=` semantics on the primary key
await neode.update(adam, { age: 31 })

// Relate two saved nodes (resolved by the relationship's key on the schema)
await neode.relate(Person, adam, rex, 'pets', { since: '2024-01-01' })

// Eager relationships hydrate on read
const reloaded = await neode.find(Person, adam.id)
// reloaded.pets → hydrated Pet instances

// Hydrated entities get active-record methods. With TypeScript, annotate
// with WithMethods<T> — see the API reference for the typing caveat.
await (reloaded as WithMethods<Person>).update({ age: 32 })

// Remove just the relationship…
await neode.detach(Person, adam, rex, 'pets')

// …or delete the node — optionally cascading into related nodes
await neode.delete(adam, { cascade: true })
```

## The Map-Based API

Prefer plain objects? The classic neode schema API is still here — map definitions and decorators feed the same metamodel, so every operation above behaves identically.

```typescript
neode.with({
  Person: {
    id: { type: 'uuid', primary: true },
    name: { type: 'string', unique: true },
    age: 'number', // shorthand: property : type
    pets: {
      type: 'relationship',
      relationship: 'OWNS',
      direction: 'out',
      target: 'Pet',
      eager: true,
    },
  },
  Pet: {
    id: { type: 'uuid', primary: true },
    name: 'string',
  },
})

const Person = neode.model('Person')
const Pet = neode.model('Pet')

const adam = await neode.create(Person, { name: 'Adam' })
const rex = await neode.create(Pet, { name: 'Rex' })

await neode.relate(Person, adam, rex, 'pets')
```

`model(name, schema)`, `with(models)`, `withDirectory(path)` and `extend(name, as, schema)` are all supported — see [map-based schema definitions](docs/api-reference.md#map-based-schema-definitions).

> **Model definitions are process-global.** Models registered through `model()` / `with()` / decorators live in one shared registry, so every `Neode` instance in a process sees them — two instances defining the same model name share whichever definition loaded last. One set of models per process is the intended shape; run separate processes for separate schemas.

## Validation

Validation rules use neode's rule names, powered by [Zod](https://zod.dev). Every write path — `save`, `create`, `update` — is validated.

```typescript
@NodeEntity()
class User {
  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', required: true, min: 2, max: 50 })
  name: string

  @Property({ type: 'string', email: true })
  email: string

  @Property({ type: 'number', min: 0, max: 150 })
  age: number
}

await neode.save(Object.assign(new User(), { name: 'A', email: 'not-an-email' }))
// throws a validation error collecting every failing check:
//   "name" length must be at least 2 characters long
//   "email" must be a valid email
```

The full rule list is in the [API reference](docs/api-reference.md#validation-rules).

## Schema

Constraints and indexes are declared in your model config (`unique: true`, `index: true`, `required: true`) and installed on demand with modern, idempotent Cypher:

```typescript
await neode.installSchema() // CREATE CONSTRAINT … IF NOT EXISTS / CREATE INDEX … IF NOT EXISTS
await neode.dropSchema()
```

`exists` constraints need Neo4j Enterprise — set `NEO4J_ENTERPRISE=true` or call `neode.setEnterprise(true)`.

## Docs

| Document                                           | Contents                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [docs/migration-guide.md](docs/migration-guide.md) | Migrating from neode 0.4.9 — IDs, facade signatures, sessions, batch, cascade, and what's new                            |
| [docs/api-reference.md](docs/api-reference.md)     | Full API — decorators, map schemas, facade methods, transactions, events, repositories, validation, connection providers |
