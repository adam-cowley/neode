/**
Cookbook — CRUD lifecycle, Collection and toJson.

The full write/read cycle: create, find by primary key and elementId, list,
update, serialise through toJson() / Collection#toJson(), delete.

Run against a local dev database (see the root README for the NEO4J_* env
vars):  npx tsx examples/cookbook/crud-collection.ts
*/
import { Collection, InternalId, NodeEntity, Property, Uuid, fromEnv, toJson } from 'neode'

@NodeEntity()
class Person {
  @InternalId()
  _id!: string

  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string

  @Property({ type: 'number' })
  age!: number
}

async function main(): Promise<void> {
  const neode = fromEnv()

  try {
    // CREATE — validated, hydrated, nested relationship targets written too
    const adam = await neode.create(Person, { name: 'Adam', age: 30 })

    // READ — by primary key, by elementId, as a filtered list, as a page
    const found = await neode.find(Person, adam.id)
    const byElementId = await neode.findById(Person, adam._id)
    const first = await neode.getFirst(Person, { name: 'Adam' })
    const everyone = await neode.all(Person, {}, 'name', 10, 0)

    console.log(
      `found ${found?.name} / ${byElementId?.name} / ${first?.name} of ${everyone.length}`,
    )

    // UPDATE — `+=` semantics: only the given properties change
    await neode.update(adam, { age: 31 })

    // Collection — array-like wrapper over results (iterate, map, find),
    // serialising every entity through toJson()
    const people = Collection.from(await neode.get(Person, {}))
    for (const person of people) {
      console.log(`- ${person.name} (${person.age})`)
    }
    console.log(JSON.stringify(people.toJson(), null, 2))

    // toJson also works on a single entity: plain properties, _id, _labels
    console.log(toJson(first))

    // DELETE
    await neode.delete(adam)
  } finally {
    await neode.close()
  }
}

main().catch(console.error)
