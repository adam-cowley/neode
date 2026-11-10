/**
Cookbook — runAll() and explicit transactions.

runAll(): several statements in ONE transaction — every statement is
attempted, and on any failure the whole batch rolls back with a
TransactionError carrying the per-statement errors. (v3's batch(),
renamed — the statements run sequentially; the one transaction is the
point, not throughput.)
inWriteTransaction(): a unit of work mixing raw Cypher and facade
operations; any throw rolls everything back.

Run:  npx tsx examples/cookbook/run-all-and-transactions.ts
*/
import { NodeEntity, Property, fromEnv } from 'neode'

@NodeEntity()
class Tag {
  @Property({ type: 'string' })
  name!: string
}

async function main(): Promise<void> {
  const neode = fromEnv()

  try {
    // All-or-nothing: raw statements and parameterised ones together
    const results = await neode.runAll([
      'CREATE (:Tag {name: "alpha"})',
      { query: 'CREATE (:Tag {name: $name})', params: { name: 'beta' } },
    ])
    console.log(`runAll wrote ${results.length} statements`)

    // One bad statement rolls back the WHOLE batch — including the
    // statements that succeeded before it
    try {
      await neode.runAll(['CREATE (:Tag {name: "gamma"})', 'CREATE BAD SYNTAX'])
    } catch (error) {
      console.error('runAll rolled back:', error instanceof Error ? error.message : error)
    }

    // Explicit transaction: several operations, one commit, rollback on throw.
    // The unit of work commits (or rolls back) EXPLICITLY — nothing is
    // written until it does.
    await neode.inWriteTransaction(async (tx) => {
      try {
        await tx.writeCypher('CREATE (:Tag {name: $name})', { name: 'from-transaction' })

        const output = await tx.writeCypher('MATCH (t:Tag) RETURN count(t) AS count')
        console.log(`tags inside the transaction: ${String(output.records[0]?.get('count'))}`)

        await tx.commit()
      } catch (error) {
        await tx.rollback()
        throw error
      }
    })

    const tags = await neode.get(Tag, {})
    console.log(`tags after the run: ${tags.length}`)
    await Promise.all(tags.map((tag) => neode.delete(tag)))
  } finally {
    await neode.close()
  }
}

main().catch(console.error)
