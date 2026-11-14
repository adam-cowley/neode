import { Neode } from '../../../src/neode.service'
import {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams,
  QueryRecord,
  TransactionHandle,
} from '../../../src/driver/types'

// ---- ConnectionProvider fake (same pattern as bound-builder-nts-554.test.ts) ----

const EMPTY: QueryOutput = { records: [] }

const row = (values: Record<string, unknown>): QueryRecord => ({
  get: (key: string) => values[key],
  has: (key: string) => key in values,
  keys: Object.keys(values),
})

class RecordingProvider implements ConnectionProvider {
  readonly calls: { statement: string; params?: QueryParams; mode?: AccessMode }[] = []

  constructor(private readonly outputs: QueryOutput[] = []) {}

  async run(statement: string, params?: QueryParams, mode?: AccessMode): Promise<QueryOutput> {
    this.calls.push({ statement, params, mode })

    return this.outputs.shift() ?? EMPTY
  }

  async beginTransaction(): Promise<TransactionHandle> {
    throw new Error('not used in this suite')
  }

  async edition(): Promise<'community'> {
    return 'community'
  }

  async close(): Promise<void> {}
}

// NTS-613 — BoundBuilder .first() / .scalar() terminals for the one-row read shape
describe('BoundBuilder .first() / .scalar() — one-row read terminals', () => {
  it('.first() resolves the first row of a multi-row result', async () => {
    const provider = new RecordingProvider([
      {
        records: [row({ status: 'first' }), row({ status: 'second' })],
      },
    ])

    const first = await new Neode(provider).query().return('status').first()

    expect(first?.get('status')).toBe('first')
  })

  it('.first() resolves undefined on an empty result', async () => {
    const provider = new RecordingProvider([EMPTY])

    const first = await new Neode(provider).query().return('status').first()

    expect(first).toBeUndefined()
  })

  it('.first() routes READ and merges caller parameters over builder params', async () => {
    const provider = new RecordingProvider([EMPTY])

    await new Neode(provider).query().param('extra', 'builder').first({ extra: 'caller' })

    expect(provider.calls[0].mode).toBe('READ')
    expect(provider.calls[0].params).toEqual({ extra: 'caller' })
  })

  it('.scalar() reads the named column of the first row', async () => {
    const provider = new RecordingProvider([
      {
        records: [row({ status: 'active' }), row({ status: 'inactive' })],
      },
    ])

    const status = await new Neode(provider).query().return('s.status AS status').scalar('status')

    expect(status).toBe('active')
  })

  it('.scalar() resolves undefined on an empty result', async () => {
    const provider = new RecordingProvider([EMPTY])

    const status = await new Neode(provider).query().return('s.status AS status').scalar('status')

    expect(status).toBeUndefined()
  })

  it('.scalar() forwards caller parameters', async () => {
    const provider = new RecordingProvider([EMPTY])

    await new Neode(provider).query().scalar('status', { id: 'p1' })

    expect(provider.calls[0].params).toEqual({ id: 'p1' })
  })
})
