/**
 * Type-checked mirror of the 1.0-side code snippets in docs/migration-guide.md.
 *
 * Every 1.0 snippet in the guide appears here as a function body, so the
 * compiler keeps them honest:
 *
 * - `pnpm typecheck` (tsc) type-checks this file
 * - `pnpm test:types` (vitest typecheck) runs the assertions below
 * - test/unit/migration-guide.test.ts asserts every 1.0 snippet line in the
 *   guide appears here — edit a snippet in the guide and here together.
 *
 * The wrappers are never executed: registration side effects
 * (@NodeEntity, defineModel) only exist at runtime.
 */
import { describe, expectTypeOf, it } from 'vitest'
import neo4j from 'neo4j-driver'

import Neode, {
  Builder,
  Direction,
  EventType,
  InternalId,
  NodeEntity,
  OneToMany,
  Property,
  TransactionError,
  Uuid,
  ValidationError,
  defineModel,
  fromEnv,
  toJson,
} from '../../src/index.js'
import type { WithMethods } from '../../src/index.js'

export function connectForDriver() {
  const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'password'))
  const neode = Neode.forDriver(driver, 'neo4j', true) // database, enterprise

  return neode
}

export function connectFromEnv() {
  const neode = fromEnv()

  return neode
}

export function mapModels(neode: Neode): void {
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
}

export function defineStandalone() {
  const Person = defineModel('Person', {
    person_id: { primary: true, type: 'uuid' },
    name: { type: 'string', unique: true },
    age: 'number',
  })

  return Person
}

export function batchRegister(neode: Neode): void {
  neode.with({ Movie: { title: 'string' }, Person: { name: 'string' } })
  neode.withDirectory('./models') // model modules, name from filename
}

@NodeEntity()
export class Movie {
  @Property({ type: 'string' })
  title!: string
}

@NodeEntity()
export class Person {
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

export async function ids(neode: Neode): Promise<unknown> {
  const saved = await neode.create(Person, { name: 'Adam' })

  const byPk = await neode.find(Person, saved.person_id) // primary key
  const byElementId = await neode.findById(Person, saved._id) // elementId string

  return [byPk, byElementId]
}

export async function facade(neode: Neode): Promise<unknown> {
  const adam = await neode.getFirst(Person, { name: 'Adam' })
  const movie = await neode.getFirst(Movie, { title: 'The Matrix' })

  if (adam && movie) {
    await neode.relate(Person, adam, movie, 'actsIn', { role: 'Neo' })
    await neode.detach(Person, adam, movie, 'actsIn')
  }

  return [adam, movie]
}

export async function rawCypher(neode: Neode): Promise<unknown> {
  const output = await neode.cypher('MATCH (p:Person) RETURN p LIMIT 10')
  await neode.writeCypher('CREATE (p:Person { name: $name })', { name: 'Adam' })

  return output
}

export async function unitOfWork(neode: Neode): Promise<void> {
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
}

export async function explicitHandle(neode: Neode): Promise<unknown> {
  const tx = await neode.openWriteTransaction()

  try {
    await tx.writeCypher('CREATE (p:Person { name: $name })', { name: 'Adam' })
    await tx.commit()
  } catch (error) {
    await tx.rollback()
    throw error
  }

  return tx
}

export async function builderBuild(neode: Neode): Promise<unknown> {
  const { query, params } = new Builder()
    .match('this', 'Person')
    .where('this.age', 29)
    .return('this')
    .build()

  const output = await neode.writeCypher(query, params)

  return output
}

export async function builderExecute(neode: Neode): Promise<unknown> {
  const output = await new Builder()
    .match('this', 'Person')
    .where('this.age', 29)
    .return('this')
    .execute(neode.getConnection(), 'READ')

  return output
}

export async function collections(neode: Neode): Promise<unknown> {
  const people = await neode.all(Person, {}, 'name')
  const first = people[0]
  for (const person of people) {
    console.log(person.name)
  }

  if (first) {
    const json = toJson(first)
    console.log(json)
  }

  return people
}

export class ValidationEmail {
  @Property({ type: 'string', min: 2, max: 50, email: true })
  email!: string
}

export async function validationCatch(neode: Neode): Promise<void> {
  try {
    await neode.create(Person, { name: 'A', email: 'not-an-email' })
  } catch (error) {
    if (error instanceof ValidationError) {
      console.warn(error.message)
    }
  }
}

export async function batch(neode: Neode): Promise<unknown> {
  try {
    const results = await neode.batch([
      'CREATE (n:Person { name: "Adam" })',
      { query: 'CREATE (n:Person { name: $name })', params: { name: 'Joe' } },
    ])
    console.log(results.length)

    return results
  } catch (error) {
    if (error instanceof TransactionError) {
      console.warn(error.message)
    }

    return undefined
  }
}

export async function cascade(neode: Neode): Promise<void> {
  const adam = (await neode.create(Person, { name: 'Adam' })) as WithMethods<Person>

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
}

export async function instanceMethods(neode: Neode): Promise<void> {
  const saved = (await neode.create(Person, { name: 'Adam' })) as WithMethods<Person>
  await saved.update({ age: 30 })
  await saved.delete({ cascade: true, mode: 'detach' })
}

export async function repositories(neode: Neode): Promise<unknown> {
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

  console.log(byAge, total, deleted)

  return people
}

export async function schemaSync(neode: Neode): Promise<unknown> {
  await neode.installSchema() // create constraints + indexes declared by the models
  await neode.dropSchema() // drop them again — deterministic, so the round-trip is exact

  const diff = await neode.schemaDiff()
  console.log(neode.formatSchemaDiff(diff)) // human-readable missing / stale / mismatched report

  return diff
}

export function events(neode: Neode): void {
  neode.on(EventType.NODE_CREATED, (entity) => {
    console.log('created:', entity)
  })

  neode.on(EventType.QUERY_EXECUTED, (event) => {
    console.log('query executed:', event)
  })
}

describe('migration guide snippets', () => {
  it('facade queries return plain arrays of entities, not a Collection', () => {
    const all = Neode.prototype['all']<Person>

    expectTypeOf(all).returns.toEqualTypeOf<Promise<Person[]>>()
  })

  it('the builder builds a query plus parameters', () => {
    const built = new Builder().match('this', 'Person').where('this.age', 29).return('this').build()

    expectTypeOf(built.query).toEqualTypeOf<string>()
  })
})
