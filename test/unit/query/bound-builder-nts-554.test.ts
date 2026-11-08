import { Neode } from '../../../src/neode.service'
import { Builder, BoundBuilder, Direction } from '../../../src/query'
import {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams,
  TransactionHandle,
} from '../../../src/driver/types'

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

// NTS-554 — Neode#query(): Builder bound to the instance with .read()/.write()
describe('Neode#query() — bound Builder with terminals', () => {
  const chain = (builder: Builder): Builder =>
    builder
      .match('o', 'Order')
      .relationship('CONTAINS', Direction.OUTGOING, 'line')
      .to('p', 'Product')
      .return('o', 'p')

  it('produces a statement byte-identical to the explicit Builder', () => {
    const neode = new Neode(new RecordingProvider())

    expect(chain(neode.query()).build().query).toBe(chain(new Builder()).build().query)
  })

  it('is a Builder: the inherited fluent surface and execute() carry over', () => {
    const neode = new Neode(new RecordingProvider())

    expect(neode.query()).toBeInstanceOf(Builder)
    expect(typeof neode.query().execute).toBe('function')
  })

  it('.read() builds and runs through the facade, routed READ', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await chain(neode.query()).read()

    expect(provider.calls[0].statement).toBe(chain(new Builder()).build().query)
    expect(provider.calls[0].mode).toBe('READ')
  })

  it('.write() builds and runs through the facade, routed WRITE', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await neode.query().create('p', 'Person', { name: 'Adam' }).write()

    expect(provider.calls[0].mode).toBe('WRITE')
    expect(provider.calls[0].statement).toBe(
      new Builder().create('p', 'Person', { name: 'Adam' }).build().query,
    )
  })

  it('terminal parameters merge over the builder params', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await neode.query().match('p', 'Person').param('extra', 'builder').read({ extra: 'caller' })

    expect(provider.calls[0].params).toEqual({ extra: 'caller' })
  })

  it('forwards the query(database) argument to the terminals', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await neode.query('aux').match('p').return('p').read()

    expect(provider.calls[0].database).toBe('aux')
  })

  it('tx.query() runs its terminals in the transaction scope', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await neode.inWriteTransaction(async (tx) => {
      await chain(tx.query()).read()
      await tx.query().create('p', 'Person', { name: 'Adam' }).write()

      return null
    })

    expect(provider.txCalls.map((call) => call.statement)).toEqual([
      chain(new Builder()).build().query,
      new Builder().create('p', 'Person', { name: 'Adam' }).build().query,
    ])
    expect(provider.calls).toEqual([])
  })

  it('BoundBuilder is exported and constructible with an INeode scope', () => {
    const neode = new Neode(new RecordingProvider())

    expect(new BoundBuilder(neode).match('n').return('n').build().query).toBe('MATCH (n)\nRETURN n')
  })
})
