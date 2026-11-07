import { vi } from 'vitest'
import { Neode } from '../../src/neode.service'
import { EventType } from '../../src/common/events'
import { NodeEntity, InternalId, Uuid, String, OneToMany } from '../../src/decorators'
import { Direction } from '../../src/query'
import {
  AccessMode,
  ConnectionProvider,
  GraphRelationship,
  QueryOutput,
  QueryParams,
  QueryRecord,
  TransactionHandle,
} from '../../src/driver/types'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Movie {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String()
  title: string

  @OneToMany(() => Movie, 'ACTED_IN', Direction.OUTGOING)
  actors: Movie[]
}

// ---- ConnectionProvider fake ------------------------------------------------

const ELEMENT_ID = '4:unit:1'
const UUID = '11111111-1111-4111-8111-111111111111'

function record(get: (key: string) => unknown, keys: string[]): QueryRecord {
  return { get, has: (key) => keys.includes(key), keys }
}

/**
 * Answers with just enough canned data for save / delete / relate to run
 * against a fake graph, and records every statement it is asked to run.
 */
class FakeProvider implements ConnectionProvider {
  readonly statements: string[] = []

  /**
  What the next merge "did": 1 = created a node, 0 = matched an existing
  one (drives the NODE_CREATED / NODE_UPDATED event split)
  */
  mergeCreates = 1

  async run(
    statement: string,
    _parameters?: QueryParams,
    _mode?: AccessMode,
    _database?: string,
  ): Promise<QueryOutput> {
    this.statements.push(statement)

    // relate(): MATCH (from:Movie ...) MATCH (to:Movie ...) MERGE/CREATE ... RETURN rel
    if (statement.includes('MATCH (from:')) {
      const relationship: GraphRelationship = {
        elementId: '4:unit:rel:1',
        type: 'ACTED_IN',
        startElementId: ELEMENT_ID,
        endElementId: '4:unit:2',
        properties: {},
      }

      return { records: [record((key) => (key === 'rel' ? relationship : undefined), ['rel'])] }
    }

    if (statement.includes('DETACH DELETE')) {
      return { records: [] }
    }

    if (statement.includes('MERGE')) {
      // save(): elementId of the merged node + honest write counters
      return {
        records: [record((key) => (key === '__id' ? ELEMENT_ID : undefined), ['__id'])],
        summary: { counters: { nodesCreated: this.mergeCreates } },
      }
    }

    // findById after save: the hydrated node
    const node = {
      elementId: ELEMENT_ID,
      labels: ['Movie'],
      properties: { id: UUID, title: 'Alien' },
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

describe('Neode events', () => {
  const makeNeode = () => {
    const provider = new FakeProvider()

    return { provider, neode: new Neode(provider) }
  }

  const makeMovie = (): Movie => Object.assign(new Movie(), { id: UUID, title: 'Alien' })

  it('on() returns the instance for chaining', () => {
    const { neode } = makeNeode()
    const handler = () => {}

    expect(neode.on(EventType.NODE_CREATED, handler)).toBe(neode)

    neode.off(EventType.NODE_CREATED, handler)
  })

  it('save() emits NODE_CREATED with the hydrated entity', async () => {
    const { neode } = makeNeode()
    const handler = vi.fn()
    neode.on(EventType.NODE_CREATED, handler)

    const saved = await neode.save(makeMovie())

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toBeInstanceOf(Movie)
    expect(handler.mock.calls[0][0].title).toBe('Alien')
    expect(saved).toBeInstanceOf(Movie)

    neode.off(EventType.NODE_CREATED, handler)
  })

  it('save() of an existing node emits NODE_UPDATED, not NODE_CREATED', async () => {
    const { provider, neode } = makeNeode()

    provider.mergeCreates = 0 // the merge matched: the node already existed

    const created = vi.fn()
    const updated = vi.fn()
    neode.on(EventType.NODE_CREATED, created)
    neode.on(EventType.NODE_UPDATED, updated)

    const saved = await neode.save(makeMovie())

    expect(created).not.toHaveBeenCalled()
    expect(updated).toHaveBeenCalledTimes(1)
    expect(updated.mock.calls[0][0]).toBeInstanceOf(Movie)
    expect(saved).toBeInstanceOf(Movie)

    neode.off(EventType.NODE_UPDATED, updated)
  })

  it('off() stops the handler from firing', async () => {
    const { neode } = makeNeode()
    const handler = vi.fn()
    neode.on(EventType.NODE_DELETED, handler)
    neode.off(EventType.NODE_DELETED, handler)

    await neode.delete(makeMovie())

    expect(handler).not.toHaveBeenCalled()
  })

  it('delete() emits NODE_DELETED with the deleted entity', async () => {
    const { neode } = makeNeode()
    const handler = vi.fn()
    neode.on(EventType.NODE_DELETED, handler)

    const entity = makeMovie()
    await neode.delete(entity)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toBe(entity)

    neode.off(EventType.NODE_DELETED, handler)
  })

  it('relate() emits RELATIONSHIP_CREATED with forceCreate and RELATIONSHIP_MERGED without', async () => {
    const { neode } = makeNeode()
    const created = vi.fn()
    const merged = vi.fn()
    neode.on(EventType.RELATIONSHIP_CREATED, created)
    neode.on(EventType.RELATIONSHIP_MERGED, merged)

    const from = makeMovie()
    const to = Object.assign(new Movie(), { id: UUID, title: 'Sequel' })

    await neode.relate(Movie, from, to, 'actors', {}, true)
    expect(created).toHaveBeenCalledTimes(1)
    expect(created.mock.calls[0][0]).toMatchObject({ type: 'ACTED_IN' })
    expect(merged).not.toHaveBeenCalled()

    await neode.relate(Movie, from, to, 'actors')
    expect(merged).toHaveBeenCalledTimes(1)

    neode.off(EventType.RELATIONSHIP_CREATED, created)
    neode.off(EventType.RELATIONSHIP_MERGED, merged)
  })
})
