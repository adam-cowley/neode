/**
 * Type-checked mirror of the compilable code snippets in docs/api-reference.md
 * (NTS-648).
 *
 * Every snippet that is valid TypeScript appears here as a function body or
 * class, so the compiler keeps the docs honest:
 *
 * - `pnpm typecheck` (tsc) type-checks this file
 * - `pnpm test` runs it through vitest's typecheck project
 * - test/unit/api-reference.test.ts asserts every snippet line in the doc
 *   appears here — edit a snippet in the doc and here together.
 *
 * The wrappers are never executed: registration side effects (@NodeEntity,
 * defineModel) and database calls only exist at runtime.
 *
 * The doc's signature listings (option-elided pseudo-code such as
 * `neode.save<T>(entity: T, database?): Promise<T>`) are not valid TypeScript
 * and are fingerprint-skipped by the unit test instead; the public-surface
 * import block lives in api-reference-import-surface.test-d.ts.
 */
import { describe, expectTypeOf, it } from 'vitest'
import Neode, {
  Builder,
  Computed,
  ConstraintViolationError,
  Default,
  Derived,
  Direction,
  EndNode,
  EntityRepository,
  EventType,
  Expression,
  expr,
  InternalId,
  isTransientError,
  knn,
  LabelPresent,
  NodeEntity,
  ontology,
  ontologyMarkdown,
  Primary,
  Property,
  RelatedMany,
  RelatedOne,
  RelationshipCount,
  RelationshipEntity,
  RelationshipExists,
  Repository,
  runSeeders,
  search,
  Seeder,
  seededRandom,
  SoftDelete,
  StartNode,
  toFulltextQuery,
  toJson,
  TransientError,
  Uuid,
  ValidationError,
} from 'neode'
import type {
  AccessMode,
  ConnectionProvider as RealConnectionProvider,
  CypherOptions,
  DeleteOptions,
  DetachResult,
  EntityMethods as RealEntityMethods,
  GraphRelationship,
  QueryOutput,
  QueryParams,
  Runner,
  TransactionHandle,
  WithMethods,
} from 'neode'

// --- Context models -------------------------------------------------------
// The doc snippets reference these models; the mirror defines them once here.

@NodeEntity()
export class User {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string

  @Property({ type: 'string' })
  email?: string
}

@NodeEntity()
export class Person {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string

  @Property({ type: 'number' })
  age!: number
}

@NodeEntity()
export class Pet {
  @Property({ type: 'string' })
  name!: string
}

@NodeEntity()
export class Role {
  @Property({ type: 'string' })
  name!: string

  @Property({ type: 'string' })
  description?: string
}

@NodeEntity()
export class Course {
  @Property({ type: 'string' })
  title!: string
}

@NodeEntity()
export class Lesson {
  @Property({ type: 'string' })
  slug!: string
}

@NodeEntity()
export class Customer {
  @Property({ type: 'string' })
  customerID!: string

  @Property({ type: 'string' })
  companyName!: string

  @Property({ type: 'string' })
  country!: string
}

@NodeEntity()
export class Supplier {
  @Property({ type: 'string' })
  supplierID!: string
}

@NodeEntity()
export class Territory {
  @Property({ type: 'string' })
  territoryID!: string
}

// Block: `@NodeEntity(config?)` — labels
@NodeEntity({ labels: ['Person', 'Actor'] })
export class Actor {
  /* … */
}

// Block: property decorators on `Movie`
@NodeEntity()
export class Movie {
  @InternalId()
  _id!: string

  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string', unique: true })
  title!: string

  @Property({ type: 'datetime' })
  @Default(() => new Date().toISOString())
  createdAt!: string
}

// Block: relationship entities
@RelationshipEntity()
export class Rating {
  @InternalId() _id!: string

  @StartNode(() => User) user!: User
  @EndNode(() => Movie) movie!: Movie

  @Property({ type: 'number' })
  score!: number
}

// Block: read-model projection decorators
@NodeEntity()
export class Learner {
  @InternalId() _id!: string

  @Property({ type: 'string' })
  firstName!: string

  @Property({ type: 'string' })
  lastName!: string

  @RelatedOne({ type: 'IN_COURSE', direction: 'out', target: () => Course, fields: ['title'] })
  course?: Pick<Course, 'title'> // nested read-only DTO

  @RelatedMany({ type: 'COMPLETED_LESSON', target: () => Lesson, fields: ['slug'] })
  completedLessons!: string[] // single field → scalar array

  @RelationshipCount({ type: 'COMPLETED_LESSON', direction: 'out' })
  completedCount!: number // inline COUNT { } subquery

  @RelationshipExists({ type: 'NEXT_LESSON', direction: 'out' })
  hasNextLesson!: boolean // inline EXISTS { } boolean

  @LabelPresent('OptionalLesson')
  isOptional!: boolean // true when the node has the label

  @Expression('size((this)-[:KNOWS]->())')
  friendCount!: number // raw Cypher, `this` = the root node

  @Computed((entity) => `${(entity as Learner).firstName} ${(entity as Learner).lastName}`)
  fullName!: string // computed in TypeScript after hydration
}

// Block: stored derived properties
export function durationBetween(_from: string, _to: string): string {
  return 'P1D'
}

export class Order {
  @Property({ type: 'datetime' }) orderDate!: string
  @Property({ type: 'datetime' }) shippedDate?: string

  // TypeScript-side: runs against the entity's property record
  @Property({ type: 'duration' })
  @Derived({
    from: ['orderDate', 'shippedDate'],
    compute: (o) => durationBetween(String(o['orderDate']), String(o['shippedDate'])),
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

// Block: soft delete + observers share one `Product` model
@NodeEntity()
@SoftDelete() // label defaults to 'Deleted'
export class Product {
  @Primary() @Property({ type: 'number' }) productID!: number
  @Property({ type: 'string' }) name!: string
  @Property({ type: 'string' }) slug?: string
  @Property({ type: 'boolean' }) ['protected']?: boolean
}

// Block: recommended target() + Pick annotations
@NodeEntity()
export class PlacedOrder {
  @RelatedOne({
    type: 'PLACED_BY',
    direction: 'out',
    target: () => Customer,
    fields: ['customerID', 'companyName', 'country'],
  })
  customer?: Pick<Customer, 'customerID' | 'companyName' | 'country'>
}

// --- Snippet wrappers -----------------------------------------------------

// Block: validation errors carry a details array
export async function validationErrorDetails(neode: Neode): Promise<void> {
  try {
    await neode.save(Object.assign(new User(), { email: 'nope' }))
  } catch (e) {
    if (e instanceof ValidationError) e.details
  }
}

// Block: map-based schema definitions
export function mapSchema(neode: Neode): void {
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
}

// Block: passing cypher() options as a variable (NTS-617)
export async function cypherOptionsVariable(neode: Neode, query: string): Promise<unknown> {
  const options = { hydrate: Order } satisfies CypherOptions
  await neode.cypher(query, undefined, options) // Promise<Order[]>

  return options
}

// Block: create()/merge() extra labels
export function builderMultiLabel(): void {
  new Builder().create('p', ['Person', 'Admin'], { name: 'Adam' }).return('p').build()
  new Builder().merge('p', ['Person', 'Admin'], { name: 'Adam' }).return('p').build()
}

// Block: WhereNull / LabelPredicate
export function builderPredicates(): void {
  new Builder().match('n').whereNull('n.deletedAt') // WHERE n.deletedAt IS NULL
  new Builder().match('n').whereLabel('n', 'Completed') // WHERE n:Completed
  new Builder().match('n').orderByLabel('n', 'Completed', 'DESC') // ORDER BY n:Completed DESC
}

// Block: shortestPath — shortest-path patterns
export function builderShortestPath(): void {
  new Builder()
    .match('a', 'Product', { productID: 1 })
    .match('b', 'Product', { productID: 2 })
    .shortestPath('p', 'a', 'b', { relationship: 'CONTAINS', degrees: '..2' })
    .return(`[n IN ${expr.nodes('p')} | labels(n)[0]] AS kinds`)
    .build()
}

// Block: transactions
export async function explicitTransaction(neode: Neode): Promise<unknown> {
  const adam = new Person()
  const joe = new Person()
  const tx = await neode.openWriteTransaction() // or openReadTransaction()
  try {
    await tx.save(adam)
    await tx.relate(Person, adam, joe, 'knows', { since: '2024-01-01' })
    await tx.commit() // …or tx.rollback()
  } catch (e) {
    await tx.rollback()
    throw e
  }

  return tx
}

// Block: the callback form
export async function transactionCallbacks(neode: Neode): Promise<unknown> {
  await neode.inWriteTransaction(async (tx) => {
    const result = tx.getRunner()
    return result
  })
  await neode.inReadTransaction(async (tx) => {
    const result = tx.getRunner()
    return result
  })

  return undefined
}

// Block: events
export function events(neode: Neode): void {
  neode.on(EventType.NODE_CREATED, (entity) => console.log('created', entity))
}

// Block: repositories
export async function repositories(neode: Neode): Promise<unknown> {
  const adam = new Person()
  const people = neode.getRepository(Person)

  await people.save(adam)
  await people.findAll({ age: 30 }, { order: { name: 'DESC' }, limit: 10, skip: 0 })
  await people.count({ age: 30 })

  return people
}

// Block: custom repositories
@EntityRepository(Person)
export class PeopleRepository extends Repository<Person> {
  findAdults(): Promise<Person[]> {
    return this.findAll().then((people) => people.filter((p) => p.age >= 18))
  }
}

export async function customRepositories(neode: Neode): Promise<unknown> {
  const people = neode.getRepository(Person) // → PeopleRepository

  return people
}

// Block: schema sync
export async function schemaSync(neode: Neode): Promise<unknown> {
  const results = await neode.installSchema()

  await neode.dropSchema()

  return results
}

// Block: soft delete
export async function softDelete(neode: Neode): Promise<void> {
  const repo = neode.getRepository(Product)
  await repo.delete('p1') // SETs :Deleted + deletedAt = datetime()
  await repo.find('p1') // undefined — filtered
  await repo.findAll({}, { includeDeleted: true }) // opts back in
  await repo.restore('p1') // removes the label + stamp
  await repo.delete('p1', { force: true }) // real DETACH DELETE
}

// Block: observers
function slugify(value: string): string {
  return value.toLowerCase().replaceAll(' ', '-')
}

const audit = { log: (_event: string, _entity: unknown): void => {} }

export function observers(neode: Neode): () => void {
  const off = neode.observe(Product, {
    beforeSave: (entity) => {
      const product = entity as Product // hooks receive the entity loosely typed
      product.slug ??= slugify(product.name)
    }, // create path: receives the properties record
    afterSave: (entity, { isNew }) => audit.log(isNew ? 'created' : 'updated', entity),
    beforeDelete: (entity) => {
      const product = entity as Product
      if (product.protected) throw new Error('protected')
    },
    afterDelete: (entity) => audit.log('deleted', entity),
  })

  return off
}

// Block: traversals
export async function traversal(neode: Neode): Promise<unknown> {
  const rows = await neode
    .traverse(Product)
    .where({ productID: 1 }) // declared-property filters on the start node
    .hop('SUPPLIED_BY', Direction.OUTGOING, Supplier) // class or lazy thunk
    .hop('COVERS', Direction.INCOMING, Territory, '1..2') // variable-length hop
    .run()

  rows[0]?.nodes // [Product, Supplier, Territory] — hydrated entities

  return rows
}

// Block: aggregate traversals
export async function aggregateTraversal(neode: Neode, orderID: string): Promise<unknown> {
  const rows = await neode
    .traverse(Order)
    .where({ orderID })
    .hop('CONTAINS', Direction.OUTGOING, Product) //  t1: this order's products
    .hop('CONTAINS', Direction.INCOMING, Order) //    t2: other orders…
    .hop('CONTAINS', Direction.OUTGOING, Product) // t3: …and what they contain
    .exclude('t0', 'CONTAINS', 't3') // not already in THIS order
    .groupBy('t3')
    .countDistinct('t2', 'times')
    .orderBy('times', 'DESC')
    .limit(5)
    .runAggregates()

  return rows
}

// Block: the connection port, mirrored as an interface and checked against
// the real one (the doc's interface must stay structurally compatible)
interface ConnectionProvider {
  run(
    statement: string,
    parameters?: QueryParams,
    mode?: AccessMode,
    database?: string,
  ): Promise<QueryOutput>
  beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle>
  edition(): Promise<'enterprise' | 'community' | 'unknown'>
  close(): Promise<void>
}

export const _docConnectionProvider: ConnectionProvider = {} as RealConnectionProvider

// Block: the EntityMethods interface, mirrored from the doc and checked
// against the real one
interface EntityMethods {
  save(): Promise<this> // MERGE, re-hydrate
  update(properties?: Record<string, unknown>): Promise<this> // `+=`, re-hydrate
  delete(options?: DeleteOptions | string): Promise<this>
  // With { soft: 'Archived' } the label is SET instead and the refreshed
  // entity is returned; otherwise the node is deleted and the (detached)
  // instance is returned.
  addLabel(label: string): Promise<this> // SET n:Label, re-hydrate
  removeLabel(label: string): Promise<this> // REMOVE n:Label, re-hydrate
  relateTo(
    other: object,
    relationshipKey: string,
    properties?: Record<string, unknown>,
    shouldForceCreate?: boolean,
  ): Promise<GraphRelationship | undefined>
  detachFrom<To extends object>(other: To, relationshipKey: string): Promise<DetachResult<this, To>>
  toJson(): Record<string, unknown>
}

export const _docEntityMethods: EntityMethods = {} as RealEntityMethods

// Block: instance methods at runtime
export async function instanceMethodsRuntime(neode: Neode): Promise<unknown> {
  const adam = await neode.create(Person, { name: 'Adam' })

  return adam
}

// Block: the WithMethods cast
export async function withMethods(neode: Neode): Promise<WithMethods<Person>> {
  const adam = (await neode.create(Person, { name: 'Adam' })) as WithMethods<Person>
  await adam.update({ age: 31 })
  await adam.save() // works at runtime on any hydrated instance

  return adam
}

// Block: collection & serialisation
export function serialisation(person: Person): unknown {
  const json = toJson(person)

  return json
}

// Block: search — full-text & vectors
export async function searchRunner(
  runner: Runner,
  vector: number[],
  query: string,
): Promise<unknown> {
  const vectorHits = await knn(runner, Person, 'person_plot_vector', vector, 5)
  const textHits = await search(runner, Person, 'person_plot', toFulltextQuery(query))

  return [vectorHits, textHits]
}

// Block: batch import — files and streams into the bulk APIs
async function* emptyRows(): AsyncIterable<Record<string, unknown>> {}

function createReadStream(_path: string): {
  pipe(_: unknown): AsyncIterable<Record<string, unknown>>
} {
  return { pipe: () => emptyRows() }
}

function parse(_options: { columns: boolean }): unknown {
  return undefined
}

export async function batchImport(neode: Neode): Promise<Record<string, unknown>[]> {
  const batch: Record<string, unknown>[] = []

  for await (const record of createReadStream('products.csv').pipe(parse({ columns: true }))) {
    batch.push(record)

    if (batch.length === 1000) {
      await neode.mergeMany(Product, batch)
      batch.length = 0
    }
  }

  if (batch.length > 0) await neode.mergeMany(Product, batch)

  return batch
}

// Block: batch import — rowToProperties
export async function rowPipeline(neode: Neode, record: Record<string, unknown>): Promise<unknown> {
  const batch: unknown[] = []
  const rejected: { line: number; errors: unknown }[] = []
  const line = 1

  const result = await neode.rowToProperties(Product, record, { map: { product_name: 'name' } })

  if (result.ok) {
    batch.push(result.properties)
  } else {
    rejected.push({ line, errors: result.errors }) // ValidationDetail[]: message / path / type per check
  }

  return [batch, rejected]
}

// Block: factories & seeding
export async function factoriesAndSeeders(neode: Neode): Promise<unknown> {
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

  return [users, drafts, people, random]
}

// Block: errors
export async function typedErrors(neode: Neode): Promise<void> {
  const user = new Person()
  const retry = (_error: TransientError): void => {}

  try {
    await neode.save(user)
  } catch (e) {
    if (isTransientError(e)) retry(e) // TransientError: retry may succeed
    if (e instanceof ConstraintViolationError) e.label // parsed from the message when the backend names it
  }
}

// Block: agent ontology
const server = {
  resource: (_name: string, _factory: () => string): void => {},
  tool: (_name: string, _handler: () => Promise<unknown>): void => {},
}

export function ontologyServer(): unknown {
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

  return systemPrompt
}

describe('api-reference.md snippets', () => {
  it('the WithMethods cast unlocks the instance methods', () => {
    async function probe(neode: Neode): Promise<unknown> {
      const adam = (await neode.create(Person, { name: 'Adam' })) as WithMethods<Person>

      return adam.update({ age: 31 })
    }

    expectTypeOf(probe).returns.toEqualTypeOf<Promise<unknown>>()
  })
})
