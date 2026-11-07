/**
Cookbook — validation: rules on properties, collecting every failure.

Every write path (save / create / update / merge) validates against the
rules declared on the properties. All failing checks are collected into
one ValidationError — shape: `details` (message / path / type per check),
`input` (the rejected values).

Run:  npx tsx examples/cookbook/validation.ts
*/
import { NodeEntity, Property, Uuid, fromEnv } from 'neode'

@NodeEntity()
class User {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string', required: true, min: 2, max: 50 })
  name!: string

  @Property({ type: 'string', email: true })
  email!: string

  @Property({ type: 'number', min: 0, max: 150 })
  age!: number
}

async function main(): Promise<void> {
  const neode = fromEnv()

  try {
    try {
      await neode.create(User, { name: 'A', email: 'not-an-email', age: 900 })
    } catch (error) {
      if (error instanceof Error && error.name === 'ValidationError') {
        const details = (error as { details?: Array<{ message: string }> }).details ?? []

        console.error(`Rejected: ${details.length} failing checks`)
        for (const detail of details) {
          console.error(`- ${detail.message}`)
        }
      } else {
        throw error
      }
    }

    // Values passing every rule are written normally
    const ok = await neode.create(User, { name: 'Adam', email: 'adam@example.com', age: 30 })
    console.log(`created ${ok.id}`)
    await neode.delete(ok)
  } finally {
    await neode.close()
  }
}

main().catch(console.error)
