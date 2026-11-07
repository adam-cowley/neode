import { Neode } from '../../src/neode.service'
import { NodeEntity, String } from '../../src/decorators'
import {
  ConnectionProvider,
  QueryOutput,
  QueryParams,
  QueryRecord,
  TransactionHandle,
} from '../../src/driver/types'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

// Labels given unsorted: the schema sorts them, the write must render
// them sorted (:Alpha:Beta)
@NodeEntity({ labels: ['Beta', 'Alpha'] })
class MultiLabelPerson {
  @String()
  name!: string
}

// ---- ConnectionProvider fake ------------------------------------------------

const ELEMENT_ID = '4:unit:1'

function record(get: (key: string) => unknown, keys: string[]): QueryRecord {
  return { get, has: (key) => keys.includes(key), keys }
}

/**
 * Records every statement it is asked to run and answers with just enough
 * canned data for create / mergeOn to run against a fake graph.
 */
class FakeProvider implements ConnectionProvider {
  readonly statements: string[] = []

  async run(statement: string, _parameters?: QueryParams): Promise<QueryOutput> {
    this.statements.push(statement)

    if (statement.startsWith('CREATE (this:')) {
      return {
        records: [record((key) => (key === '__id' ? ELEMENT_ID : undefined), ['__id'])],
      }
    }

    if (statement.includes('MERGE')) {
      return {
        records: [record((key) => (key === '__id' ? ELEMENT_ID : undefined), ['__id'])],
      }
    }

    // The find-after-write hydration
    const node = {
      elementId: ELEMENT_ID,
      labels: ['Alpha', 'Beta'],
      properties: { name: 'Adam' },
    }

    return { records: [record((key) => (key === 'this' ? node : undefined), ['this'])] }
  }

  async beginTransaction(): Promise<TransactionHandle> {
    return new FakeHandle(this)
  }

  async edition() {
    return 'community' as const
  }

  async close() {}
}

class FakeHandle implements TransactionHandle {
  constructor(private readonly provider: FakeProvider) {}

  run(statement: string): Promise<QueryOutput> {
    return this.provider.run(statement)
  }

  async commit() {}

  async rollback() {}
}

// -----------------------------------------------------------------------------

describe('multi-label models', () => {
  const makeNeode = () => {
    const provider = new FakeProvider()

    return { provider, neode: new Neode(provider) }
  }

  it('create() writes every label of the schema', async () => {
    const { provider, neode } = makeNeode()

    await neode.create(MultiLabelPerson, { name: 'Adam' })

    const create = provider.statements.find((statement) => statement.startsWith('CREATE (this:'))

    expect(create).toBeDefined()
    expect(create).toMatch(/^CREATE \(this:Alpha:Beta \{ name: \$this_name \}\)/)
  })

  it('mergeOn() matches on every label of the schema', async () => {
    const { provider, neode } = makeNeode()

    await neode.mergeOn(MultiLabelPerson, { name: 'Adam' })

    const merge = provider.statements.find((statement) => statement.startsWith('MERGE (this:'))

    expect(merge).toBeDefined()
    expect(merge).toMatch(/^MERGE \(this:Alpha:Beta \{ name: \$this_name \}\)/)
  })
})
