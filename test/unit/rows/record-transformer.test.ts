import { describe, expect, it } from 'vitest'
import { defineModel } from '../../../src/index.js'
import { Neode } from '../../../src/neode.service.js'
import type {
  ConnectionProvider,
  QueryOutput,
  QueryRecord,
  TransactionHandle,
} from '../../../src/driver/types.js'

/** A hand-built QueryRecord over a plain map — no database */
function recordOf(values: Record<string, unknown>): QueryRecord {
  return {
    get: (key) => values[key],
    has: (key) => key in values,
    keys: Object.keys(values),
  }
}

/** ConnectionProvider stub returning one fixed result */
class StubProvider implements ConnectionProvider {
  private readonly output: QueryOutput

  constructor(output: QueryOutput) {
    this.output = output
  }

  async run(): Promise<QueryOutput> {
    return this.output
  }

  async beginTransaction(): Promise<TransactionHandle> {
    throw new Error('not used')
  }

  async edition(): Promise<'unknown'> {
    return 'unknown'
  }

  async close(): Promise<void> {}
}

const twoRows: QueryOutput = {
  records: [recordOf({ id: '1' }), recordOf({ id: '2' })],
}

describe('recordTransformer (NTS-632)', () => {
  it('replaces the rows with the transformer output on cypher()', async () => {
    const neode = new Neode(new StubProvider(twoRows))

    const result = await neode.cypher(
      'MATCH (p:Person) RETURN p.id AS id',
      {},
      {
        recordTransformer: (row) => ({ id: row.get('id') }),
      },
    )

    expect(result.records).toEqual([{ id: '1' }, { id: '2' }])
  })

  it('hands the transformer JSON-safe values (bigint → string)', async () => {
    const neode = new Neode(new StubProvider({ records: [recordOf({ stamp: 1n })] }))

    const result = await neode.cypher(
      'RETURN 1 AS stamp',
      {},
      {
        recordTransformer: (row) => ({ stamp: row.get('stamp') }),
      },
    )

    expect(result.records).toEqual([{ stamp: '1' }])
  })

  it('works on the read() and write() sugar', async () => {
    const neode = new Neode(new StubProvider(twoRows))

    const read = await neode.read(
      'MATCH (p:Person) RETURN p.id AS id',
      {},
      {
        recordTransformer: (row) => ({ id: row.get('id') }),
      },
    )
    const write = await neode.write(
      'MATCH (p:Person) RETURN p.id AS id',
      {},
      {
        recordTransformer: (row) => ({ id: row.get('id') }),
      },
    )

    expect(read.records).toEqual([{ id: '1' }, { id: '2' }])
    expect(write.records).toEqual([{ id: '1' }, { id: '2' }])
  })
})

describe('recordTransformer + hydrate (NTS-632)', () => {
  it('hydrate wins: the rows hydrate untouched and the transformer never runs', async () => {
    const Person = defineModel('RowTransformerPerson632', { id: { type: 'string' } })

    const neode = new Neode(
      new StubProvider({
        records: [
          recordOf({
            this: {
              elementId: '4:0:0',
              labels: ['RowTransformerPerson632'],
              properties: { id: 'p1' },
            },
          }),
        ],
      }),
    )

    const entities = await neode.cypher(
      'MATCH (p:RowTransformerPerson632) RETURN p',
      {},
      {
        hydrate: Person,
        alias: 'this',
        recordTransformer: () => {
          throw new Error('the transformer must not run when hydrate is set')
        },
      },
    )

    expect(entities).toHaveLength(1)
    expect(entities[0]).toMatchObject({ id: 'p1' })
  })
})
