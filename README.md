# neode

neode is a Neo4j OGM for Node.js designed to take care of the CRUD boilerplate involved with setting up a graph database project. Just install, define your models and go.

It runs against any Cypher-compatible engine: **Neo4j** (Community, Enterprise, Aura) and **Memgraph** over Bolt, or the embedded [Relate](https://github.com/relateapp/relate) engine in-process.

Coming from [neode](https://github.com/adam-cowley/neode) 0.4.9? Your existing map-based schemas keep working — read the [migration guide](docs/migration-guide.md).

> **1.0 alpha.** This branch is the `1.0.0-alpha.0` prerelease line. Install it with the `next` dist-tag — `npm install neode` still gives you 0.4.9 until 1.0 goes stable.

## Quickstart

Four steps: install, connect, define a model, round-trip.

### 1. Install

```bash
npm install neode@next
```

Requires Node.js 20 or newer (Neo4j 5.x / 2025.x servers, `neo4j-driver` 6).

### 2. Connect

```typescript
// index.ts
import { fromEnv } from 'neode'

// Reads NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE (and the
// rest of the NEO4J_* set) — or from a .env file
const neode = fromEnv()
```

Already have a driver, or want the embedded engine? Every connect option is real:

```typescript
import neo4j from 'neo4j-driver'
import Neode from 'neode'

const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'password'))

const neode = Neode.forDriver(driver) // over a neo4j-driver Driver
// Neode.forRelate(database)          // or: embedded Relate engine, in-process
```

### 3. Define a model — pick your style

Two definition APIs. They feed the same metamodel and the same registry, so they are **interchangeable** — pick one per project or mix freely, and every read/write path behaves identically either way (parity between the two is covered by the golden-parity test suite).

```typescript
// Decorators — a plain class, standard TC39 decorators
import { NodeEntity, Property, Uuid } from 'neode'

@NodeEntity()
export class Person {
  @Uuid({ primary: true }) // auto-generated UUID primary key
  id: string

  @Property({ type: 'string', unique: true, required: true, min: 2, max: 50 })
  name: string

  @Property({ type: 'int' })
  age: number
}
```

```typescript
// Map-based — no decorators, same result
import { defineModel } from 'neode'

export const Person = defineModel('Person', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true, required: true, min: 2, max: 50 },
  age: 'int', // shorthand: property : type
})
```

Both return a class you can pass to the facade, repositories and services below.

### 4. Round-trip

```typescript
// Create — validated against the model before the write
const adam = await neode.create(Person, { name: 'Adam', age: 30 })

// Read — by primary key, or by filter
const found = await neode.find(Person, adam.id)
const people = await neode.get(Person, { age: 30 })

// Update
await neode.update(adam, { age: 31 })

// Delete
await neode.delete(adam)
```

Then create the constraints and indexes the model declares (`unique`, `index`, …):

```typescript
await neode.installSchema() // CREATE CONSTRAINT … IF NOT EXISTS / CREATE INDEX … IF NOT EXISTS
await neode.dropSchema() // reverses installSchema() exactly
```

`exists` constraints need Neo4j Enterprise — set `NEO4J_ENTERPRISE=true` or call `neode.setEnterprise(true)`.

`unique` and `index` also take a property list: `@Property({ type: 'string', index: ['city', 'region'] })` declares one composite range index over N properties (the array is the full composite, declared on one of its properties), and `installSchema()` / `dropSchema()` / `schemaDrift()` / `applySchemaDrift()` treat it like every other declaration. Two Neo4j limits: uniqueness constraints are single-property — for a composite pair, node key constraints are the Enterprise composite analogue — while composite range indexes have no such restriction.

That's the whole loop. Everything else the library does is in the matrix below.

> **Model definitions are process-global.** Models registered through decorators, `defineModel()` or `neode.model()` / `with()` live in one shared registry, so every `Neode` instance in a process sees them. One set of models per process is the intended shape; run separate processes for separate schemas. A model name registers once: `defineModel()` throws a descriptive error on a second registration of the same name (the previous silent overwrite orphaned the first model's schema), and `defineModel(name, schema, { idempotent: true })` returns the existing registration unchanged — the form to use where the defining module is re-evaluated (Nest HMR, Vitest watch mode).

## REST API from the model definitions

`neode/express` mounts every registered node model as a REST API — the routes, validation, filtering and serialization are all generated from the definitions:

```typescript
import express from 'express'
import { router } from 'neode/express'

const app = express()

app.use(express.json())
app.use('/api', router(neode))
app.listen(3000)
```

Per model: `GET /:model` (paginated list — `page`, `limit`, `order`, `sort`, plus equality filters on declared properties, so `GET /api/Person?age=30`), `GET /:model/:id` (primary key), `POST /:model` (create, 201), `PATCH /:model/:id` (update), `DELETE /:model/:id` (delete, 204). `GET /api` returns the ontology — a self-describing index of every mounted model. Errors map onto statuses: validation 422, unique conflicts and optimistic locks 409, domain errors 400.

Writes go through exactly the same validated pipeline as the facade, and reads apply the model's named filters (soft delete, tenancy) — the router adds no bespoke checks. Options: `{ models: ['Person'] }` mounts a subset; `{ middleware: [...] }` mounts auth (or any pass-through hook) before every generated route. Writes trust whatever middleware is in front of the router — an unauthenticated mount is an open write API.

## Feature matrix

| Area                  | What you get                                                                                                                                                                                                                                                                                     | Details                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Property types        | `any`, `string`, `number`, `int`, `integer`, `float`, `boolean`, `uuid`, `date`, `time`, `datetime`, `localtime`, `localdatetime`, `point`, `duration` — plus `array`, defaults, `primary` / `unique` / `index`, `hidden` / `protected` / `readonly`, `onCreateSet` / `onMatchSet` / `alwaysSet` | [Entities & decorators](docs/api-reference.md#entities--decorators)      |
| Validation            | Zod-powered rule names in the property config (`required`, `min` / `max`, `email`, `regex`, `uuid`, …). Every write path — `save`, `create`, `update` — is validated, with all failures collected into one error                                                                                 | [Validation rules](docs/api-reference.md#validation-rules)               |
| Relationships         | `@OneToOne` / `@OneToMany` (eager loading), relationship entities with `@StartNode` / `@EndNode`, `relate()` / `detach()` with edge properties, cascade delete options                                                                                                                           | [Relationship decorators](docs/api-reference.md#relationship-decorators) |
| Read-model decorators | `@RelatedOne`, `@RelatedMany`, `@RelationshipCount`, `@RelationshipExists`, `@LabelPresent`, `@Computed`, `@Expression` — projected into the read query, one query per read                                                                                                                      | [API reference](docs/api-reference.md#entities--decorators)              |
| Repositories          | `Repository<Entity>` — `find`, `findAll`, `count`, `save`, `patch`, `upsert`, `delete`, `restore`, `increment`, `countBy`, `deleteAll` — plus custom `@EntityRepository` subclasses (TypeORM parity)                                                                                             | [Repositories](docs/api-reference.md#repositories)                       |
| Soft delete           | `@SoftDelete('Deleted')` — delete stamps a label + `deletedAt`, every standard read filters it, `restore()` un-stamps, `delete(force)` hard-deletes                                                                                                                                              | [Soft delete](docs/api-reference.md#soft-delete)                         |
| Observers             | `neode.observe(Model, { beforeSave, afterSave, beforeDelete, afterDelete })` — hooks inside the write; errors fail it and roll back                                                                                                                                                              | [Observers](docs/api-reference.md#observers)                             |
| Traversals            | `neode.traverse(Model).hop(type, dir, Target, { degrees }).where(props).run()` — typed multi-hop reads, one hydrated row per path                                                                                                                                                                | [Traversals](docs/api-reference.md#traversals)                           |
| Transactions          | `inReadTransaction` / `inWriteTransaction` callback form, `openReadTransaction` / `openWriteTransaction` handle form, and `batch()` with per-statement errors                                                                                                                                    | [Transactions](docs/api-reference.md#transactions)                       |
| Events                | `EventType.NODE_CREATED` / `NODE_UPDATED` / `NODE_DELETED`, `RELATIONSHIP_CREATED` / `RELATIONSHIP_MERGED`, `QUERY_EXECUTED` — emitted synchronously, scoped to the instance, inside and outside transactions                                                                                    | [Events](docs/api-reference.md#events)                                   |
| Schema sync & drift   | `installSchema()` / `dropSchema()` with deterministic names, `inspectSchema()`, and the drift workflow: `schemaDrift()` → `formatSchemaDrift()` → `applySchemaDrift()`                                                                                                                           | [Schema sync](docs/api-reference.md#schema-sync)                         |
| Full-text search      | `search()` over a full-text index, `toFulltextQuery()` to escape user input — hydrated entities with relevance scores                                                                                                                                                                            | [kNN & full-text search](#knn--full-text-search)                         |
| Vector search         | `@Vector({ dimensions })` on a property + `knn()` k-nearest-neighbour search (Cypher 25 `SEARCH` clause with a procedure fallback)                                                                                                                                                               | [kNN & full-text search](#knn--full-text-search)                         |
| Pagination            | Offset mode `{ page, limit, order? }` and cursor/keyset mode `{ limit, orderBy, after?/before? }` on a temporal property, both via `neode.paginate()`                                                                                                                                            | [The Neode facade](docs/api-reference.md#the-neode-facade)               |
| Bulk writes           | `createMany()` / `mergeMany()` — chunked `UNWIND` writes, one managed transaction per chunk, rows validated like single creates; a failed chunk rolls back whole (valid rows included) and reports failing row indexes; `rowToProperties()` maps CSV/JSON rows for batch import                  | [Bulk writes](docs/api-reference.md#bulk-writes--pagination)             |
| Querying              | Fluent `Builder` (all values parameterised), raw `neode.cypher()`, `hydrate` / `hydrateFirst` / `toCollection`, `toJson()` / `jsonSafe()` serialisation                                                                                                                                          | [Query builder](docs/api-reference.md#query-builder)                     |
| Error taxonomy        | Typed `NeodeError` base, `ConstraintViolationError` (with parsed `label` / `property`), `TransientError` (retryable), `classifyError()` / `isTransientError()`                                                                                                                                   | [API reference](docs/api-reference.md)                                   |
| Agent ontology        | `ontology()` / `ontologyMarkdown()` — emit the live graph schema for grounding Text2Cypher prompts or MCP resources                                                                                                                                                                              | [API reference](docs/api-reference.md)                                   |
| REST API              | `neode/express` — `router(neode)` mounts list / get / create / update / delete for every model, generated from the definitions, with error→status mapping and a self-describing ontology index                                                                                                   | [REST API](#rest-api-from-the-model-definitions)                         |
| Testing & ops         | `wipe()`, `testId()`, data factories (`neode.factory()`), `verifyConnectivity()` / `waitUntilReachable()`, `splitCypherStatements()` / `runCypherScript()`                                                                                                                                       | [API reference](docs/api-reference.md)                                   |

### Benchmarks

Vitest benches live in [`bench/`](bench/) — read/hydration/validation throughput and, in
[`bench/write-bolt.bench.ts`](bench/write-bolt.bench.ts), the neode write path (`create()` / `createMany()` /
`merge()` / `mergeMany()`) against raw Cypher over the neo4j-driver (Bolt) path at 300 / 3,000 / 30,000 rows,
recording wall-clock and statements per write. They run manually against a local Neo4j testcontainer (needs Docker)
and are not part of the default test gate:

```sh
./node_modules/.bin/vitest bench --project unit bench/write-bolt.bench.ts
```

Dated runs are recorded in [`bench/results/`](bench/results/) — e.g.
[2026-11-11-write.md](bench/results/2026-11-11-write.md) for the write-path numbers (headline: batched
`UNWIND` writes are 8–35x faster than per-row writes and within ~3x of the raw single-statement ceiling;
statements per write, not OGM pipeline time, is what separates the strategies).

### Testing against Aura

`test/integration/aura-smoke.test.ts` provisions a real, ephemeral AuraDB instance through the Aura API, smokes schema / bulk-write / read / pagination against it, and destroys it in teardown — nothing outlives the run. Opt in with Aura API client credentials (Aura console → Account settings → Client credentials):

```sh
AURA_CLIENT_ID=… AURA_CLIENT_SECRET=… AURA_PROJECT_ID=… pnpm test:aura
```

The credentials are read from the environment, never logged; `AURA_ORGANIZATION_ID` is optional (discovered when omitted). CI runs the same smoke on demand via the manual `aura` workflow (set the `AURA_CLIENT_ID` / `AURA_CLIENT_SECRET` / `AURA_PROJECT_ID` repo secrets).

### kNN & full-text search

```typescript
import { knn, search, toFulltextQuery } from 'neode'

const runner = neode.getRunner()

const vectorHits = await knn(runner, 'Person', 'person_plot_vector', vector, 5)
const textHits = await search(runner, 'Person', 'person_plot', toFulltextQuery(query))
```

Indexes are declared on the model — `@Vector({ dimensions: 1536 })` for vectors (installed by `installSchema()`), `fulltext: true` on a property or `installFulltextIndexes(definitions)` for full-text. One caveat: vector search takes its top `k` neighbours _before_ filtering, so a filtered kNN can return fewer than `k` rows — over-fetch with a larger `k` and post-filter in your code.

## Docs

| Document                                           | Contents                                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [docs/api-reference.md](docs/api-reference.md)     | Full API — decorators, map schemas, facade methods, transactions, events, repositories, validation, connection providers    |
| [docs/migration-guide.md](docs/migration-guide.md) | Migrating from neode 0.4.9 — IDs, facade signatures, sessions, batch, cascade, and what's new                               |
| [examples/cookbook/](examples/cookbook)            | Runnable script per capability — CRUD, relationships, eager loading & read models, validation, schema, search, transactions |

## Agent skills

Agent-readable skill packs ship in the package and the repo under `skills/`:

| Skill                         | Contents                                                                                                                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills/neode/SKILL.md`       | Generated quick reference — define models, query, relate, transact, common mistakes. Regenerated from source by `pnpm docs:agents`                                                                                                                                |
| `skills/neode-model/SKILL.md` | Interactive walkthrough for designing and creating models — domain discussion, entity/relationship sketch, decorator suggestions, code; reports inexpressible scenarios, boilerplate and library errors back as Linear issues (NTS) and opens PRs for small fixes |

Install a skill into your agent by copying the directory into its skills folder (OpenCode: `.opencode/skills/`, Claude Code: `.claude/skills/`; global equivalents live under `~/.config/opencode/` and `~/.claude/`):

```sh
# from the repo checkout
cp -r skills/neode-model .opencode/skills/

# or from the installed package
cp -r node_modules/neode/skills/neode-model .opencode/skills/
```

The rest of the agent surface — `AGENTS.md`, `docs/agent/`, `llms.txt`, `llms-full.txt`, `skills/neode/` — is generated by `pnpm docs:agents` and ships in the npm tarball too.
