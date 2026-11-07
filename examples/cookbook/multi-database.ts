/**
Cookbook — multi-database: a default database plus per-call overrides.

setDatabase() names the database every call targets by default (Neo4j 4+ /
Enterprise for named databases); each API that touches the graph also
accepts an explicit `database` argument that wins over the default.

Run:  npx tsx examples/cookbook/multi-database.ts
*/
import { NodeEntity, Property, Uuid, fromEnv } from 'neode'

@NodeEntity()
class Person {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string
}

async function main(): Promise<void> {
  const neode = fromEnv()

  try {
    // Default database for every subsequent call
    neode.setDatabase('neo4j')

    const adam = await neode.create(Person, { name: 'Adam' })

    // Per-call override: the same OGM, another database — say an audit
    // copy maintained alongside the primary one
    await neode.save(adam, 'audit')

    const audits = await neode.get(Person, {}, undefined, undefined, 'audit')
    console.log(`audit copy holds ${audits.length} person node(s)`)

    // Raw Cypher overrides per call too, through CypherOptions
    const output = await neode.cypher(
      'MATCH (p:Person) RETURN count(p) AS count',
      {},
      {
        database: 'audit',
      },
    )
    console.log(`count via cypher: ${String(output.records[0]?.get('count'))}`)

    await neode.delete(adam)
  } finally {
    await neode.close()
  }
}

main().catch(console.error)
