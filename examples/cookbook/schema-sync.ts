/**
Cookbook — schema sync: install, inspect drift, drop.

Constraints and indexes are declared on the model config (unique / index /
required / @Vector …) and applied on demand: installSchema() runs idempotent
CREATE CONSTRAINT … IF NOT EXISTS statements; schemaDiff() reports the
declared-vs-installed state; dropSchema() removes what the models declare.

Run:  npx tsx examples/cookbook/schema-sync.ts
*/
import { NodeEntity, Property, Uuid, fromEnv } from 'neode'

@NodeEntity()
class Person {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string', unique: true })
  email!: string

  @Property({ type: 'string', index: true })
  name!: string
}

async function main(): Promise<void> {
  const neode = fromEnv()

  try {
    // Install — every statement reported (statement + success + error)
    for (const result of await neode.installSchema()) {
      console.log(`${result.success ? 'installed' : 'FAILED'}: ${result.statement}`)
    }

    // Verify — drift is data, not an error: show it, then apply the
    // missing objects (all carry IF NOT EXISTS, so this is idempotent)
    const diff = await neode.schemaDiff()
    console.log(neode.formatSchemaDiff(diff))
    await neode.applySchemaDiff(diff)

    // The declared unique constraint is live: a duplicate email rejects
    const person = await neode.create(Person, { email: 'a@example.com', name: 'Adam' })
    await neode.delete(person)

    // Drop — only the objects the models declare
    for (const result of await neode.dropSchema()) {
      console.log(`${result.success ? 'dropped' : 'FAILED'}: ${result.statement}`)
    }
  } finally {
    await neode.close()
  }
}

main().catch(console.error)
