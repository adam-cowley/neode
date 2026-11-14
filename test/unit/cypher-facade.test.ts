import neo4j from 'neo4j-driver'
import { Neode } from '../../src/neode.service'
import { EventType, QueryExecutedEvent } from '../../src/common/events'
import { NodeEntity, InternalId, Uuid, Property } from '../../src/decorators'
import {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams,
  QueryRecord,
  TransactionHandle,
} from '../../src/driver/types'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Person {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string
}

// ---- ConnectionProvider fake ------------------------------------------------

interface CapturedCall {
  statement: string
  params?: QueryParams
  mode?: AccessMode
  database?: string
}

const EMPTY: QueryOutput = { records: [] }

const NODE: QueryRecord = {
  get: (key: string) =>
    key === 'this' || key === 'node'
      ? { elementId: '4:unit:1', labels: ['Person'], properties: { name: 'Adam' } }
      : undefined,
  has: (key: string) => key === 'this' || key === 'node',
  keys: ['this'],
}

/** Records every statement (with mode/database) and answers with canned outputs. */
class RecordingProvider implements ConnectionProvider {
  readonly calls: CapturedCall[] = []
  readonly txCalls: CapturedCall[] = []

  constructor(private readonly outputs: QueryOutput[] = []) {}

  async run(
    statement: string,
    params?: QueryParams,
    mode?: AccessMode,
    database?: string,
  ): Promise<QueryOutput> {
    this.calls.push({ statement, params, mode, database })

    return this.outputs.shift() ?? EMPTY
  }

  async beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle> {
    return {
      run: async (statement: string, params?: QueryParams) => {
        this.txCalls.push({ statement, params, mode, database })

        return this.outputs.shift() ?? EMPTY
      },
      commit: async () => {},
      rollback: async () => {},
    }
  }

  async edition(): Promise<'community'> {
    return 'community'
  }

  async close(): Promise<void> {}
}

/** Driver stub capturing the session access mode (neo4j provider behaviour). */
class FakeDriver {
  lastAccessMode?: string

  session(options: { defaultAccessMode?: string }): unknown {
    this.lastAccessMode = options.defaultAccessMode

    return {
      run: async () => ({ records: [], summary: { counters: { updates: () => ({}) } } }),
      close: async () => {},
    }
  }

  async close(): Promise<void> {}
}

// ---------------------------------------------------------------------------

describe('Neode#cypher (raw escape hatch)', () => {
  it('routes READ by default and passes statement, params and database through', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await neode.cypher('RETURN 1 AS one', { x: 1 }, { database: 'aux' })

    expect(provider.calls[0]).toEqual({
      statement: 'RETURN 1 AS one',
      params: { x: 1 },
      mode: 'READ',
      database: 'aux',
    })
  })

  it('honours the per-call routing option', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await neode.cypher('CREATE (n)', {}, { routing: 'WRITE' })

    expect(provider.calls[0].mode).toBe('WRITE')
  })

  it('honours defaultRouting from the connection options', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider, false, { defaultRouting: 'WRITE' })

    await neode.cypher('CREATE (n)')

    expect(provider.calls[0].mode).toBe('WRITE')
  })

  it('setDefaultRouting overrides the default, per-call wins over both', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    neode.setDefaultRouting('WRITE')

    await neode.cypher('CREATE (n)')
    await neode.cypher('RETURN 1', {}, { routing: 'READ' })

    expect(provider.calls[0].mode).toBe('WRITE')
    expect(provider.calls[1].mode).toBe('READ')
  })

  it('keeps readCypher/writeCypher explicit', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider, false, { defaultRouting: 'WRITE' })

    await neode.readCypher('RETURN 1')
    await neode.writeCypher('CREATE (n)')

    expect(provider.calls[0].mode).toBe('READ')
    expect(provider.calls[1].mode).toBe('WRITE')
  })

  it('exposes inner provider properties through getConnection()', async () => {
    class MarkedProvider extends RecordingProvider {
      readonly database = 'inner-db'
    }

    const neode = new Neode(new MarkedProvider())

    const connection = neode.getConnection() as unknown as { database?: string }

    expect(connection.database).toBe('inner-db')
  })

  it('uses the resolved mode for the neo4j session access mode', async () => {
    const driver = new FakeDriver()
    const neode = Neode.forDriver(driver as never, undefined, false, { defaultRouting: 'WRITE' })

    await neode.cypher('RETURN 1')

    expect(driver.lastAccessMode).toBe('WRITE')
  })

  it('returns raw output with JSON-safe rows when no hydrate option is given', async () => {
    const provider = new RecordingProvider([
      { records: [{ get: () => new neo4j.Point(7203, 1, 2), has: () => true, keys: ['p'] }] },
    ])
    const neode = new Neode(provider)

    const output = await neode.cypher('RETURN point({ x: 1, y: 2 }) AS p')

    expect(output.records).toHaveLength(1)
    expect(output.records[0].get('p')).toEqual({ srid: 7203, x: 1, y: 2 })
    expect(() => JSON.stringify(output.records[0].get('p'))).not.toThrow()
  })

  it('hydrates rows into entities of the given class', async () => {
    const provider = new RecordingProvider([{ records: [NODE] }])
    const neode = new Neode(provider)

    const results = await neode.cypher('MATCH (n:Person) RETURN n AS this', {}, { hydrate: Person })

    expect(results).toHaveLength(1)
    expect(results[0]).toBeInstanceOf(Person)
    expect(results[0].name).toBe('Adam')
  })

  it('hydrates from a custom alias column', async () => {
    const provider = new RecordingProvider([{ records: [NODE] }])
    const neode = new Neode(provider)

    const results = await neode.cypher(
      'MATCH (n:Person) RETURN n AS node',
      {},
      { hydrate: Person, alias: 'node' },
    )

    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Adam')
  })
})

describe('Neode#explain / Neode#profile', () => {
  it('prefixes EXPLAIN, routes READ and returns the plan summary', async () => {
    const provider = new RecordingProvider([
      { records: [], summary: { plan: { operatorType: 'ProduceResults' } } },
    ])
    const neode = new Neode(provider)

    const plan = await neode.explain('MATCH (n) RETURN n')

    expect(provider.calls[0].statement).toBe('EXPLAIN MATCH (n) RETURN n')
    expect(provider.calls[0].mode).toBe('READ')
    expect(plan).toEqual({ operatorType: 'ProduceResults' })
  })

  it('prefixes PROFILE, routes WRITE and returns the profile summary', async () => {
    const provider = new RecordingProvider([
      { records: [], summary: { profile: { operatorType: 'AllNodesScan' } } },
    ])
    const neode = new Neode(provider)

    const profile = await neode.profile('MATCH (n) RETURN n')

    expect(provider.calls[0].statement).toBe('PROFILE MATCH (n) RETURN n')
    expect(provider.calls[0].mode).toBe('WRITE')
    expect(profile).toEqual({ operatorType: 'AllNodesScan' })
  })

  it('passes the database option through', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await neode.explain('RETURN 1', {}, { database: 'aux' })

    expect(provider.calls[0].database).toBe('aux')
  })

  it('returns undefined when the backend produces no plan (Relate)', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    expect(await neode.explain('RETURN 1')).toBeUndefined()
    expect(await neode.profile('RETURN 1')).toBeUndefined()
  })
})

describe('query:executed event', () => {
  it('emits for raw queries with cypher, params, duration and database', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    const events: QueryExecutedEvent[] = []
    neode.on(EventType.QUERY_EXECUTED, (event) => events.push(event as QueryExecutedEvent))

    await neode.cypher('RETURN $x AS x', { x: 1 }, { database: 'aux' })

    expect(events).toHaveLength(1)
    expect(events[0].cypher).toBe('RETURN $x AS x')
    expect(events[0].params).toEqual({ x: 1 })
    expect(events[0].database).toBe('aux')
    expect(typeof events[0].duration).toBe('number')
    expect(events[0].duration).toBeGreaterThanOrEqual(0)
  })

  it('emits for statements inside transactions (service queries)', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    const statements: string[] = []
    neode.on(EventType.QUERY_EXECUTED, (event) =>
      statements.push((event as QueryExecutedEvent).cypher),
    )

    await neode.inReadTransaction(async (tx) => tx.readCypher('RETURN 1 AS one'))

    expect(statements).toEqual(['RETURN 1 AS one'])
  })

  it('emits one event per statement, in order', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    const statements: string[] = []
    neode.on(EventType.QUERY_EXECUTED, (event) =>
      statements.push((event as QueryExecutedEvent).cypher),
    )

    await neode.readCypher('RETURN 1 AS one')
    await neode.writeCypher('CREATE (n)')

    expect(statements).toEqual(['RETURN 1 AS one', 'CREATE (n)'])
  })

  it('off() unsubscribes', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    let called = false
    const handler = (): void => {
      called = true
    }

    neode.on(EventType.QUERY_EXECUTED, handler)
    neode.off(EventType.QUERY_EXECUTED, handler)

    await neode.readCypher('RETURN 1 AS one')

    expect(called).toBe(false)
  })
})
