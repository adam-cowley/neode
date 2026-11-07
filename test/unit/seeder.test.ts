import { Neode } from '../../src/neode.service'
import { Seeder, runSeeders } from '../../src/testing/seeder'
import { NodeEntity, InternalId, Uuid, String } from '../../src/decorators'
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
class SeederPerson {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  email: string

  @String({ default: 'Springfield' })
  city: string
}

// ---- ConnectionProvider fake ------------------------------------------------

let elementIds = 0

function elementIdRecord(): QueryRecord {
  const id = `4:unit:${++elementIds}`

  return {
    get: (key: string) => (key === '__id' ? id : undefined),
    has: () => true,
    keys: ['__id'],
  }
}

function nodeRecord(): QueryRecord {
  const node = {
    elementId: `4:unit:node-${elementIds}`,
    labels: ['SeederPerson'],
    properties: { id: 'u1', email: 'seed@example.com', city: 'Springfield' },
  }

  return {
    get: (key: string) => (key === 'this' ? node : undefined),
    has: () => true,
    keys: ['this'],
  }
}

interface CapturedCall {
  statement: string
  params?: QueryParams
}

/** Records every in-transaction statement; answers MERGE/CREATE with an elementId. */
class SeederProvider implements ConnectionProvider {
  readonly calls: CapturedCall[] = []

  async run(): Promise<QueryOutput> {
    return { records: [] }
  }

  async beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle> {
    return {
      run: async (statement: string, params?: QueryParams) => {
        this.calls.push({ statement, params })

        // CREATE / MERGE ... RETURN elementId(this) AS __id → the id;
        // MATCH ... RETURN this → the hydrated node
        if (statement.startsWith('CREATE') || statement.startsWith('MERGE')) {
          return { records: [elementIdRecord()] }
        }

        return { records: [nodeRecord()] }
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

/** A seeder writing one person idempotently via mergeOn (the documented pattern). */
class PersonSeeder extends Seeder {
  async seed(neode: Neode): Promise<void> {
    await neode.mergeOn(SeederPerson, { email: 'seed@example.com' }, { city: 'Springfield' })
  }
}

// -----------------------------------------------------------------------------

describe('Seeder + runSeeders (NTS-167)', () => {
  let provider: SeederProvider
  let neode: Neode

  beforeEach(() => {
    provider = new SeederProvider()
    neode = new Neode(provider)

    elementIds = 0
  })

  it('runs each seeder once, in order', async () => {
    const ran: string[] = []

    class First extends Seeder {
      async seed(): Promise<void> {
        ran.push('first')
      }
    }

    class Second extends Seeder {
      async seed(): Promise<void> {
        ran.push('second')
      }
    }

    await runSeeders(neode, [new First(), new Second()])

    expect(ran).toEqual(['first', 'second'])
  })

  it('resolves with no seeders', async () => {
    await expect(runSeeders(neode, [])).resolves.toBeUndefined()
    expect(provider.calls).toHaveLength(0)
  })

  it('lets seeders write idempotently through mergeOn', async () => {
    await runSeeders(neode, [new PersonSeeder()])

    const merges = provider.calls.filter((call) => call.statement.startsWith('MERGE'))

    expect(merges).toHaveLength(1)
    // MERGE (not CREATE) is the idempotent write: reruns match, not duplicate
    expect(merges[0]?.statement).toContain('ON CREATE SET')
  })

  it('keeps seeder writes MERGE-shaped on a rerun', async () => {
    await runSeeders(neode, [new PersonSeeder()])
    await runSeeders(neode, [new PersonSeeder()])

    const creates = provider.calls.filter((call) => call.statement.startsWith('CREATE'))

    expect(creates).toHaveLength(0)
    expect(provider.calls.filter((call) => call.statement.startsWith('MERGE'))).toHaveLength(2)
  })
})
