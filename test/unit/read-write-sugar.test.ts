import { Neode } from '../../src/neode.service'
import { Builder } from '../../src/query'
import {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams,
  QueryRecord,
  TransactionHandle,
} from '../../src/driver/types'

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
