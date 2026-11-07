/**
Cookbook — relationships: relate, detach, cascade delete vs detach.

MERGE a relationship (by the key on the from-model's schema), remove just
the relationship with detach(), then delete the owner — cascade mode
'delete' takes the related nodes with it, 'detach' leaves them alive.

Run:  npx tsx examples/cookbook/relationships.ts
*/
import { Direction, NodeEntity, OneToMany, Property, Uuid, fromEnv } from 'neode'

@NodeEntity()
class Pet {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string
}

@NodeEntity()
class Person {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string

  @OneToMany(() => Pet, 'OWNS', Direction.OUTGOING)
  pets!: Pet[]
}

async function main(): Promise<void> {
  const neode = fromEnv()

  try {
    const adam = await neode.create(Person, { name: 'Adam' })
    const rex = await neode.create(Pet, { name: 'Rex' })

    // MERGE the relationship, with properties
    await neode.relate(Person, adam, rex, 'pets', { since: '2024-01-01' })

    // Remove just the relationship — both nodes survive
    await neode.detach(Person, adam, rex, 'pets')

    // Put it back (MERGE, so re-running never duplicates it)
    await neode.relate(Person, adam, rex, 'pets')

    // Delete the owner. cascade mode 'detach' removes only the
    // relationships — Rex stays alive but unlinked; 'delete' (the
    // default cascade mode) deletes the related nodes recursively.
    await neode.delete(adam, { cascade: true, mode: 'detach' })

    const orphan = await neode.getFirst(Pet, { name: 'Rex' })
    console.log(`Rex survived the owner: ${orphan !== undefined}`)

    await neode.delete(rex)
  } finally {
    await neode.close()
  }
}

main().catch(console.error)
