import { openBackend, isEnterprise, TestBackend } from './support/backend'
import { Neode } from '../../src/neode.service'
import {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams,
  TransactionHandle,
} from '../../src/driver/types'

/**
 * Delegates every call to an inner provider while recording the `database`
 * argument — proves the facade's per-call override reaches the port.
 */
class RecordingProvider implements ConnectionProvider {
  readonly runDatabases: (string | undefined)[] = []
  readonly beginDatabases: (string | undefined)[] = []

  constructor(private readonly inner: ConnectionProvider) {}

  async run(
    statement: string,
    parameters?: QueryParams,
    mode?: AccessMode,
    database?: string,
  ): Promise<QueryOutput> {
    this.runDatabases.push(database)

    return this.inner.run(statement, parameters, mode, database)
  }

  async beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle> {
    this.beginDatabases.push(database)

    return this.inner.beginTransaction(mode, database)
  }

  async edition() {
    return this.inner.edition()
  }

  async close() {
    return this.inner.close()
  }
}

describe('multi-database wiring', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('threads setDatabase defaults and per-call overrides to the provider', async () => {
    const recording = new RecordingProvider(backend.connection)
    const neode = new Neode(recording)

    // No default, no override: the provider decides (undefined passes through)
    await neode.readCypher('RETURN 1 AS one')
    expect(recording.runDatabases[0]).toBeUndefined()

    // setDatabase() becomes the default
    neode.setDatabase('movies-db')
    await neode.readCypher('RETURN 1 AS one')
    await neode.writeCypher('RETURN 1 AS one')
    expect(recording.runDatabases[1]).toBe('movies-db')
    expect(recording.runDatabases[2]).toBe('movies-db')

    // Per-call override wins over the default
    await neode.readCypher('RETURN 1 AS one', {}, 'override-db')
    expect(recording.runDatabases[3]).toBe('override-db')

    // Transactions take the default too, and the override
    const tx = await neode.openWriteTransaction()
    await tx.rollback()
    expect(recording.beginDatabases[0]).toBe('movies-db')

    const explicit = await neode.openWriteTransaction('explicit-db')
    await explicit.rollback()
    expect(recording.beginDatabases[1]).toBe('explicit-db')
  })
})

describe('multi-database against the server', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('runs statements in a per-call named database', async (ctx) => {
    if (!backend.capabilities.multiDatabase) {
      ctx.skip() // Relate: fixed namespaces
    }

    const database = process.env.NEO4J_DATABASE || 'neo4j'

    const output = await backend.connection.run('RETURN 1 AS one', undefined, 'WRITE', database)

    expect(output.records[0].get('one')).toBe(1)
  })

  it('writes through a setDatabase default into the target database', async (ctx) => {
    if (!backend.capabilities.multiDatabase || !isEnterprise(backend.capabilities)) {
      ctx.skip() // CREATE DATABASE requires Enterprise
    }

    const name = 'ogm_multi_db_test'

    try {
      await backend.connection.run(
        `CREATE DATABASE \`${name}\` IF NOT EXISTS`,
        undefined,
        'WRITE',
        'system',
      )

      // Wait for the scratch database to come online
      for (let attempt = 0; attempt < 30; attempt++) {
        const show = await backend.connection.run(
          'SHOW DATABASES YIELD name, currentStatus',
          undefined,
          'READ',
          'system',
        )

        const row = show.records.find((record) => record.get('name') === name)

        if (row && row.get('currentStatus') === 'online') {
          break
        }

        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      const neode = new Neode(backend.connection)
      neode.setDatabase(name)

      await neode.writeCypher('CREATE (n:MultiDbProbe { name: "inside" })')

      // Not visible from the default database…
      const onDefault = await backend.connection.run('MATCH (n:MultiDbProbe) RETURN count(n) AS n')

      expect(onDefault.records[0].get('n')).toBe(0)

      // …and visible in the target database
      const onTarget = await backend.connection.run(
        'MATCH (n:MultiDbProbe) RETURN count(n) AS n',
        undefined,
        'WRITE',
        name,
      )

      expect(onTarget.records[0].get('n')).toBe(1)
    } finally {
      await backend.connection
        .run(`DROP DATABASE \`${name}\` IF EXISTS`, undefined, 'WRITE', 'system')
        .catch(() => {})
    }
  })
})
