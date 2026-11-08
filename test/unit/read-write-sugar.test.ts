import { Neode } from '../../src/neode.service'
import { Builder } from '../../src/query'
import { defineModel } from '../../src/meta/map-schema'
import {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams,
  QueryRecord,
  TransactionHandle,
} from '../../src/driver/types'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

const SugarOrder = defineModel('SugarOrder', {
  total: { type: 'number' },
})

// ---- ConnectionProvider fake (same pattern as cypher-facade.test.ts) --------

interface CapturedCall {
  statement: string
  params?: QueryParams
  mode?: AccessMode
  database?: string
}

const EMPTY: QueryOutput = { records: [] }

class RecordingProvider implements ConnectionProvider {
  readonly calls: CapturedCall[] = []
  readonly txCalls: CapturedCall[] = []

  async run(
    statement: string,
    params?: QueryParams,
    mode?: AccessMode,
    database?: string,
  ): Promise<QueryOutput> {
    this.calls.push({ statement, params, mode, database })

    return this.outputs.shift() ?? EMPTY
  }

  constructor(private readonly outputs: QueryOutput[] = []) {}

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

// NTS-553 — Neode#read / Neode#write build-and-run sugar
describe('Neode#read / Neode#write (build-and-run sugar)', () => {
  it('read(builder) runs the exact statement the explicit build() path produces', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    const build = (): string =>
      new Builder().match('p', 'Person').where('p.name', 'Adam').return('p').build().query

    await neode.read(new Builder().match('p', 'Person').where('p.name', 'Adam').return('p'))

    expect(provider.calls[0].statement).toBe(build())
    expect(provider.calls[0].mode).toBe('READ')
  })

  it('read(builder) merges caller parameters over the builder params', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await neode.read(new Builder().match('p', 'Person').param('extra', 'builder'), {
      extra: 'caller',
    })

    expect(provider.calls[0].params).toEqual({ extra: 'caller' })
  })

  it('read(string) passes the statement straight through, untouched', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    const statement = 'MATCH (p:Person) RETURN p LIMIT 10'

    await neode.read(statement, { x: 1 }, 'aux')

    expect(provider.calls[0]).toEqual({
      statement,
      params: { x: 1 },
      mode: 'READ',
      database: 'aux',
    })
  })

  it('write(builder) routes WRITE and runs the built statement', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await neode.write(new Builder().create('p', 'Person', { name: 'Adam' }).return('p'))

    expect(provider.calls[0].mode).toBe('WRITE')
    expect(provider.calls[0].statement).toBe(
      new Builder().create('p', 'Person', { name: 'Adam' }).return('p').build().query,
    )
  })

  it('write(string) passes the statement straight through, untouched', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await neode.write('CREATE (n)')

    expect(provider.calls[0]).toEqual({ statement: 'CREATE (n)', params: {}, mode: 'WRITE' })
  })

  it('tx.read / tx.write run in the transaction scope', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await neode.inWriteTransaction(async (tx) => {
      await tx.read(new Builder().match('p', 'Person').return('p'))
      await tx.write(new Builder().create('p', 'Person', { name: 'Adam' }))
      await tx.read('RETURN 1 AS one')

      return null
    })

    expect(provider.txCalls.map((call) => call.statement)).toEqual([
      new Builder().match('p', 'Person').return('p').build().query,
      new Builder().create('p', 'Person', { name: 'Adam' }).build().query,
      'RETURN 1 AS one',
    ])
    expect(provider.calls).toEqual([])
  })

  it('tx.read merges caller parameters over the builder params', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await neode.inReadTransaction(async (tx) => {
      await tx.read(new Builder().match('p', 'Person').param('extra', 'builder'), {
        extra: 'caller',
      })

      return null
    })

    expect(provider.txCalls[0].params).toEqual({ extra: 'caller' })
  })

  it('returns the query output records', async () => {
    const row: QueryRecord = { get: () => 1, has: () => true, keys: ['one'] }
    const neode = new Neode(new RecordingProvider([{ records: [row] }]))

    const output = await neode.read(new Builder().return('1 AS one'))

    expect(output.records[0].get('one')).toBe(1)
  })
})

// NTS-559 — the hydrate overloads on read() / write()
describe('Neode#read / Neode#write hydrate option', () => {
  const nodeRow = (properties: Record<string, unknown>): QueryRecord => ({
    get: (key: string) =>
      key === 'this' ? { elementId: '4:unit-1', labels: ['SugarOrder'], properties } : undefined,
    has: (key: string) => key === 'this',
    keys: ['this'],
  })

  it('read(builder, params, { hydrate }) returns hydrated entities', async () => {
    const neode = new Neode(new RecordingProvider([{ records: [nodeRow({ total: 10 })] }]))

    const entities = await neode.read(
      new Builder().match('this', 'SugarOrder').return('this'),
      {},
      {
        hydrate: SugarOrder,
      },
    )

    expect(entities).toHaveLength(1)
    expect(entities[0]).toBeInstanceOf(SugarOrder)
    expect(entities[0].total).toBe(10)
  })

  it('read(builder, { hydrate }) — the two-argument form — hydrates and passes no parameters', async () => {
    const provider = new RecordingProvider([{ records: [nodeRow({ total: 11 })] }])
    const neode = new Neode(provider)

    const entities = await neode.read(new Builder().match('this', 'SugarOrder').return('this'), {
      hydrate: SugarOrder,
    })

    expect(entities).toHaveLength(1)
    expect(entities[0].total).toBe(11)
    // the options object is never mistaken for query parameters
    expect(provider.calls[0].params).toEqual({})
  })

  it('write(builder, params, { hydrate }) returns hydrated entities', async () => {
    const neode = new Neode(new RecordingProvider([{ records: [nodeRow({ total: 5 })] }]))

    const entities = await neode.write(
      new Builder().create('this', 'SugarOrder', { total: 5 }).return('this'),
      {},
      { hydrate: SugarOrder },
    )

    expect(entities).toHaveLength(1)
    expect(entities[0].total).toBe(5)
  })

  it('honours the alias and database options', async () => {
    const provider = new RecordingProvider([
      {
        records: [
          {
            get: (key: string) =>
              key === 'o'
                ? { elementId: '4:unit-2', labels: ['SugarOrder'], properties: {} }
                : undefined,
            has: (key: string) => key === 'o',
            keys: ['o'],
          },
        ],
      },
    ])
    const neode = new Neode(provider)

    const entities = await neode.read(
      new Builder().match('o', 'SugarOrder').return('o'),
      {},
      {
        hydrate: SugarOrder,
        alias: 'o',
        database: 'aux',
      },
    )

    expect(provider.calls[0].database).toBe('aux')
    expect(entities).toHaveLength(1)
  })

  it('tx.read / tx.write hydrate in the transaction scope', async () => {
    const neode = new Neode(new RecordingProvider([{ records: [nodeRow({ total: 7 })] }]))

    await neode.inReadTransaction(async (tx) => {
      const entities = await tx.read(
        new Builder().match('this', 'SugarOrder').return('this'),
        undefined,
        {
          hydrate: SugarOrder,
        },
      )

      expect(entities).toHaveLength(1)
      expect(entities[0].total).toBe(7)

      await tx.commit()

      return null
    })
  })
})
