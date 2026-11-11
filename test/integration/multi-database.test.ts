import { openBackend, isEnterprise, TestBackend } from './support/backend'
import { Neode } from '../../src/neode.service'
import { NodeEntity, Property, Uuid } from '../../src/decorators'
import {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams,
  TransactionHandle,
} from '../../src/driver/types'

// Per-file fixture: the decorator registry is global per module
@NodeEntity()
class MultiDbPerson {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string
}

/**
 * Wraps an inner provider (edition/close forward) while recording the
 * `database` argument of every port call — proves the facade's per-call
 * override reaches the port.
 *
 * Statements are NOT forwarded: the assertions here are on the threaded
 * `database` argument only, and not forwarding keeps the fake database
 * names hermetic on real servers (which reject unknown databases).
 */
class RecordingProvider implements ConnectionProvider {
  readonly runDatabases: (string | undefined)[] = []
  readonly beginDatabases: (string | undefined)[] = []

  private readonly noOpHandle: TransactionHandle = {
    run: async () => ({ records: [] }),
    commit: async () => {},
    rollback: async () => {},
  }

  constructor(private readonly inner: ConnectionProvider) {}

  async run(
    statement: string,
    parameters?: QueryParams,
    mode?: AccessMode,
    database?: string,
  ): Promise<QueryOutput> {
    this.runDatabases.push(database)

    return { records: [] }
  }

  async beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle> {
    this.beginDatabases.push(database)

    return this.noOpHandle
  }

  async edition() {
    return this.inner.edition()
  }

  async close() {
    return this.inner.close()
  }
}

/** Create a scratch database on `system` and wait until it is online. */
async function createDatabaseOnline(connection: ConnectionProvider, name: string): Promise<void> {
  await connection.run(`CREATE DATABASE \`${name}\` IF NOT EXISTS`, undefined, 'WRITE', 'system')

  for (let attempt = 0; attempt < 30; attempt++) {
    const show = await connection.run(
      'SHOW DATABASES YIELD name, currentStatus',
      undefined,
      'READ',
      'system',
    )

    const row = show.records.find((record) => record.get('name') === name)

    if (row && row.get('currentStatus') === 'online') {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
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

  // NTS-644: the getRunner()-based reads — paginate(), findManyAndCount()
  // and search() — honour a per-call `database` over the setDatabase()
  // default
  it('threads the per-call database of paginate(), findManyAndCount() and search() to the provider', async () => {
    const recording = new RecordingProvider(backend.connection)
    const neode = new Neode(recording)
    neode.setDatabase('default-db')

    // The setDatabase default applies when no override is given (paginate
    // runs two autocommit reads: data + COUNT)
    await neode.paginate(MultiDbPerson, {}, { page: 1, limit: 10 })
    expect(recording.runDatabases[0]).toBe('default-db')
    expect(recording.runDatabases[1]).toBe('default-db')

    // The per-call override wins
    await neode.paginate(MultiDbPerson, {}, { page: 1, limit: 10, database: 'override-db' })
    expect(recording.runDatabases[2]).toBe('override-db')

    await neode.findManyAndCount(MultiDbPerson, {}, { database: 'override-db' })
    expect(recording.runDatabases[3]).toBe('override-db')

    await neode.search(MultiDbPerson, 'index', 'query', undefined, undefined, 'override-db')
    expect(recording.runDatabases[4]).toBe('override-db')
  })

  // Regression test for adam-cowley/neode#182: runAll() (v3's batch) and the
  // transaction() callback form used the wrong database
  it('threads the configured database into runAll() and transaction()', async () => {
    const recording = new RecordingProvider(backend.connection)
    const neode = new Neode(recording)

    // runAll() honours the setDatabase default, then the per-call override
    neode.setDatabase('batch-db')
    await neode.runAll(['RETURN 1 AS one'])
    await neode.runAll(['RETURN 1 AS one'], 'override-db')
    expect(recording.beginDatabases[0]).toBe('batch-db')
    expect(recording.beginDatabases[1]).toBe('override-db')

    // transaction() (the inWriteTransaction callback form) honours both too
    const committed = await neode.inWriteTransaction(async (tx) => {
      await tx.writeCypher('RETURN 1 AS one')
      await tx.commit()

      return 'done'
    })
    expect(committed).toBe('done')
    expect(recording.beginDatabases[2]).toBe('batch-db')

    await neode.inWriteTransaction(async (tx) => {
      await tx.commit()
    }, 'tx-override-db')
    expect(recording.beginDatabases[3]).toBe('tx-override-db')
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

    const name = 'ogm-multi-db-test'

    try {
      await createDatabaseOnline(backend.connection, name)

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

  // Regression: save(entity, database) on a CLEAN tracked entity used to
  // hit the dirty-check no-op and silently write nothing — the audit-copy
  // pattern (save(person, 'audit')) never reached the target database
  it('save(entity, database) lands a clean entity in the named database', async (ctx) => {
    if (!backend.capabilities.multiDatabase || !isEnterprise(backend.capabilities)) {
      ctx.skip() // CREATE DATABASE requires Enterprise
    }

    const name = 'ogm-save-audit-copy'

    try {
      await createDatabaseOnline(backend.connection, name)

      const neode = new Neode(backend.connection)

      const adam = await neode.create(MultiDbPerson, { name: 'Adam' })
      await neode.save(adam, name)

      const copies = await backend.connection.run(
        'MATCH (n:MultiDbPerson) RETURN count(n) AS n',
        undefined,
        'WRITE',
        name,
      )
      expect(copies.records[0].get('n')).toBe(1)
    } finally {
      await backend.connection
        .run(`DROP DATABASE \`${name}\` IF EXISTS`, undefined, 'WRITE', 'system')
        .catch(() => {})
    }
  })

  // NTS-644: the getRunner()-based reads target a per-call named
  // database — the override wins over the setDatabase() default
  it('paginate() and findManyAndCount() read a per-call named database', async (ctx) => {
    if (!backend.capabilities.multiDatabase || !isEnterprise(backend.capabilities)) {
      ctx.skip() // CREATE DATABASE requires Enterprise
    }

    const name = 'ogm-paginate-per-call-db'
    const other = 'ogm-paginate-per-call-db-other'

    try {
      await createDatabaseOnline(backend.connection, name)
      await createDatabaseOnline(backend.connection, other)

      const neode = new Neode(backend.connection)
      neode.setDatabase(name)

      // A probe row exists ONLY in the target database
      await backend.connection.run(
        'CREATE (:MultiDbPerson { id: $id, name: "Target" })',
        { id: 'probe-1' },
        'WRITE',
        name,
      )

      // No override: the setDatabase default applies — the row is found
      const onDefault = await neode.paginate(MultiDbPerson, {}, { page: 1, limit: 10 })
      expect(onDefault.total).toBe(1)

      const counted = await neode.findManyAndCount(MultiDbPerson)
      expect(counted.total).toBe(1)

      // The per-call override wins over the default: `other` is empty
      const onOverride = await neode.findManyAndCount(MultiDbPerson, {}, { database: other })
      expect(onOverride.total).toBe(0)

      const paged = await neode.paginate(
        MultiDbPerson,
        {},
        { page: 1, limit: 10, database: other },
      )
      expect(paged.total).toBe(0)
    } finally {
      // Clean the default database too, so a regression (reads falling
      // through to it) cannot mask missing cleanup
      await backend.connection.run('MATCH (n:MultiDbPerson) DETACH DELETE n').catch(() => {})

      for (const db of [name, other]) {
        await backend.connection
          .run(`DROP DATABASE \`${db}\` IF EXISTS`, undefined, 'WRITE', 'system')
          .catch(() => {})
      }
    }
  })

  // Regression test for adam-cowley/neode#182: transaction() and runAll()
  // used to write to the wrong database
  it('runs transaction() and runAll() in the setDatabase target', async (ctx) => {
    if (!backend.capabilities.multiDatabase || !isEnterprise(backend.capabilities)) {
      ctx.skip() // CREATE DATABASE requires Enterprise
    }

    const name = 'ogm-multi-db-tx-batch'
    const override = 'ogm-multi-db-tx-batch-override'

    try {
      await createDatabaseOnline(backend.connection, name)
      await createDatabaseOnline(backend.connection, override)

      const neode = new Neode(backend.connection)
      neode.setDatabase(name)

      // runAll() honours the configured database…
      await neode.runAll(['CREATE (n:MultiDbProbe { name: "batch" })'])

      // …transaction() too…
      await neode.inWriteTransaction(async (tx) => {
        await tx.writeCypher('CREATE (n:MultiDbProbe { name: "tx" })')
        await tx.commit()
      })

      // …and the per-call override wins over setDatabase
      await neode.runAll(['CREATE (n:MultiDbProbe { name: "override" })'], override)

      // Nothing landed on the default database
      const onDefault = await backend.connection.run('MATCH (n:MultiDbProbe) RETURN count(n) AS n')

      expect(onDefault.records[0].get('n')).toBe(0)

      // Both configured-database writes are in the target…
      const onTarget = await backend.connection.run(
        'MATCH (n:MultiDbProbe) RETURN count(n) AS n',
        undefined,
        'WRITE',
        name,
      )

      expect(onTarget.records[0].get('n')).toBe(2)

      // …and the override's write is in its own database
      const onOverride = await backend.connection.run(
        'MATCH (n:MultiDbProbe) RETURN count(n) AS n',
        undefined,
        'WRITE',
        override,
      )

      expect(onOverride.records[0].get('n')).toBe(1)
    } finally {
      // Clean the default database too, so a regression (writes landing
      // there) does not leave probe nodes behind
      await backend.connection.run('MATCH (n:MultiDbProbe) DETACH DELETE n').catch(() => {})

      for (const db of [name, override]) {
        await backend.connection
          .run(`DROP DATABASE \`${db}\` IF EXISTS`, undefined, 'WRITE', 'system')
          .catch(() => {})
      }
    }
  })
})
