import { describe, expect, it, vi } from 'vitest'
import { Neode } from '../../src/neode.service'
import { EventType } from '../../src/common/events'
import { NodeEntity, InternalId, Uuid, Primary, Property, SoftDelete } from '../../src/decorators'
import { observe, clearObservers, ObserverRegistry } from '../../src/observers'
import { defineModel, extendModel, getExtendedFrom } from '../../src/meta/map-schema'
import type {
  AccessMode,
  ConnectionProvider,
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

  @Property({ type: 'string' })
  title: string
}

@NodeEntity()
@SoftDelete() // label defaults to 'Deleted'
class SoftProduct {
  @Primary()
  @Property({ type: 'string' })
  sku!: string
}

// ---- ConnectionProvider fake (events.test.ts shape, grown for NTS-596) ------

const ELEMENT_ID = '4:unit:1'
const UUID = '11111111-1111-4111-8111-111111111111'

function record(get: (key: string) => unknown, keys: string[]): QueryRecord {
  return { get, has: (key) => keys.includes(key), keys }
}

const NODE = {
  elementId: ELEMENT_ID,
  labels: ['Movie'],
  properties: { id: UUID, title: 'Alien' },
}

/**
Canned answers for every statement shape the tested paths emit: UNWIND
(bulk, two rows), RETURN n (deleteAll's pre-read, two rows), DETACH DELETE
(the count), MERGE (save/merge with honest counters), and the re-hydration
fallthrough (one node under the `this` alias).
*/
class FakeProvider implements ConnectionProvider {
  readonly statements: string[] = []

  mergeCreates = 1

  async run(
    statement: string,
    _parameters?: QueryParams,
    _mode?: AccessMode,
    _database?: string,
  ): Promise<QueryOutput> {
    this.statements.push(statement)

    if (statement.includes('UNWIND')) {
      return {
        records: [
          record((key) => (key === 'this' ? NODE : undefined), ['this']),
          record((key) => (key === 'this' ? NODE : undefined), ['this']),
        ],
        summary: { counters: { nodesCreated: 2 } },
      }
    }

    if (statement.includes('RETURN n')) {
      return {
        records: [
          record((key) => (key === 'n' ? NODE : undefined), ['n']),
          record((key) => (key === 'n' ? NODE : undefined), ['n']),
        ],
      }
    }

    if (statement.includes('DETACH DELETE')) {
      return { records: [record((key) => (key === 'count' ? 2 : undefined), ['count'])] }
    }

    if (statement.includes('MERGE')) {
      return {
        records: [record((key) => (key === '__id' ? ELEMENT_ID : undefined), ['__id'])],
        summary: { counters: { nodesCreated: this.mergeCreates } },
      }
    }

    return {
      records: [record((key) => (key === 'this' ? NODE : undefined), ['this'])],
    }
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

describe('per-instance observer registry (NTS-596)', () => {
  it('neode.observe registers per instance — observers do not leak across instances', async () => {
    const a = new Neode(new FakeProvider())
    const b = new Neode(new FakeProvider())

    const onA = vi.fn()
    const onB = vi.fn()

    a.observe(Movie, { beforeSave: onA })
    b.observe(Movie, { beforeSave: onB })

    await a.save(Object.assign(new Movie(), { id: UUID, title: 'Alien' }))

    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).not.toHaveBeenCalled()
  })

  it('the standalone observe() keeps firing for every instance (global fallback)', async () => {
    const neode = new Neode(new FakeProvider())
    const onGlobal = vi.fn()

    const off = observe(Movie, { beforeSave: onGlobal })

    await neode.save(Object.assign(new Movie(), { id: UUID, title: 'Alien' }))

    expect(onGlobal).toHaveBeenCalledTimes(1)

    off()
  })

  it('clearObservers() drops instance-scoped registrations too', async () => {
    const neode = new Neode(new FakeProvider())
    const onSave = vi.fn()

    neode.observe(Movie, { beforeSave: onSave })
    clearObservers()

    await neode.save(Object.assign(new Movie(), { id: UUID, title: 'Alien' }))

    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('extended models fire their base observers (NTS-596)', () => {
  it('getExtendedFrom walks a clone back to its base', () => {
    const base = defineModel('NTS596Base', { id: { type: 'string', unique: true } })
    const clone = extendModel('NTS596Base', 'NTS596Clone', {})

    expect(getExtendedFrom(clone)).toBe(base)
    expect(getExtendedFrom(base)).toBeUndefined()
  })

  it('a registry runs the base model observers for the clone', async () => {
    const base = defineModel('NTS596RunBase', { id: { type: 'string', unique: true } })
    const clone = extendModel('NTS596RunBase', 'NTS596RunClone', {})

    const registry = new ObserverRegistry()
    const onSave = vi.fn()

    registry.observe(base, { beforeSave: onSave })

    await registry.run(clone, 'beforeSave', {}, { isNew: false, database: undefined })

    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('an instance-registered observer on the base fires for a clone entity save', async () => {
    const neode = new Neode(new FakeProvider())
    const onSave = vi.fn()

    const base = defineModel('NTS596ObserveBase', { id: { type: 'string', unique: true } })
    const clone = extendModel('NTS596ObserveBase', 'NTS596ObserveClone', {})

    neode.observe(base, { beforeSave: onSave })

    await neode.save(Object.assign(new clone(), { id: UUID, title: 'Alien' }))

    expect(onSave).toHaveBeenCalledTimes(1)
  })
})

describe('update() fires the save lifecycle (NTS-596)', () => {
  const makeMovie = () => Object.assign(new Movie(), { _id: ELEMENT_ID, id: UUID, title: 'Alien' })

  it('emits NODE_UPDATED with the re-hydrated entity', async () => {
    const neode = new Neode(new FakeProvider())
    const updated = vi.fn()
    neode.on(EventType.NODE_UPDATED, updated)

    const saved = await neode.update(makeMovie(), { title: 'Aliens' })

    expect(saved?.title).toBe('Alien')
    expect(updated).toHaveBeenCalledTimes(1)
    expect(updated.mock.calls[0][0]).toBeInstanceOf(Movie)

    neode.off(EventType.NODE_UPDATED, updated)
  })

  it('runs beforeSave (with the properties record) and afterSave', async () => {
    const neode = new Neode(new FakeProvider())
    const before: unknown[] = []
    const after: unknown[] = []

    neode.observe(Movie, {
      beforeSave: (entity) => before.push(entity),
      afterSave: (entity) => after.push(entity),
    })

    await neode.update(makeMovie(), { title: 'Aliens' })

    expect(before).toHaveLength(1)
    expect(before[0]).toEqual({ title: 'Aliens' })
    expect(after).toHaveLength(1)
    expect(after[0]).toBeInstanceOf(Movie)
  })

  it('a beforeSave error fails the update before any statement', async () => {
    const provider = new FakeProvider()
    const neode = new Neode(provider)

    neode.observe(Movie, {
      beforeSave: () => {
        throw new Error('nope')
      },
    })

    await expect(neode.update(makeMovie(), { title: 'Aliens' })).rejects.toThrow('nope')

    expect(provider.statements).toEqual([])
  })
})

describe('mergeOn fires NODE_MERGED (NTS-596)', () => {
  it('emits NODE_MERGED with the hydrated entity and honest isNew', async () => {
    const provider = new FakeProvider()
    const neode = new Neode(provider)

    const merged = vi.fn()
    neode.on(EventType.NODE_MERGED, merged)

    const after: { isNew: boolean }[] = []
    neode.observe(Movie, {
      afterSave: (_entity, context) => after.push({ isNew: context.isNew }),
    })

    await neode.mergeOn(Movie, { id: UUID }, { title: 'Alien' })

    expect(merged).toHaveBeenCalledTimes(1)
    expect(merged.mock.calls[0][0]).toBeInstanceOf(Movie)
    expect(after).toEqual([{ isNew: true }]) // the fake reports a creating merge

    neode.off(EventType.NODE_MERGED, merged)
  })

  it('beforeSave receives the set record before the statement', async () => {
    const provider = new FakeProvider()
    const neode = new Neode(provider)

    const seen: unknown[] = []
    neode.observe(Movie, {
      beforeSave: (entity) => {
        seen.push(entity)
        ;(entity as Record<string, unknown>).title = 'Mutated'
      },
    })

    await neode.mergeOn(Movie, { id: UUID }, { title: 'Alien' })

    expect(seen).toEqual([{ title: 'Mutated' }])
    expect(provider.statements.some((statement) => statement.includes('MERGE'))).toBe(true)
  })

  it('merge() and Repository#upsert ride the same NODE_MERGED event', async () => {
    const neode = new Neode(new FakeProvider())

    const merged = vi.fn()
    neode.on(EventType.NODE_MERGED, merged)

    await neode.merge(Movie, { id: UUID, title: 'Alien' })

    expect(merged).toHaveBeenCalledTimes(1)

    neode.off(EventType.NODE_MERGED, merged)
  })
})

describe('bulk paths fire per entity (NTS-596)', () => {
  it('createMany runs beforeSave per row and emits NODE_CREATED per created entity', async () => {
    const neode = new Neode(new FakeProvider())

    const rows = [
      { id: UUID, title: 'Alien' },
      { id: UUID, title: 'Aliens' },
    ]
    const before: unknown[] = []
    neode.observe(Movie, { beforeSave: (row) => before.push(row) })

    const created = vi.fn()
    neode.on(EventType.NODE_CREATED, created)

    const after: { isNew: boolean }[] = []
    neode.observe(Movie, {
      afterSave: (_entity, context) => after.push({ isNew: context.isNew }),
    })

    await neode.createMany(Movie, rows)

    expect(before).toEqual(rows)
    expect(created).toHaveBeenCalledTimes(2)
    expect(after).toEqual([{ isNew: true }, { isNew: true }])

    neode.off(EventType.NODE_CREATED, created)
  })

  it('mergeMany emits NODE_MERGED per merged entity', async () => {
    const neode = new Neode(new FakeProvider())

    const merged = vi.fn()
    neode.on(EventType.NODE_MERGED, merged)

    await neode.mergeMany(Movie, [
      { id: UUID, title: 'Alien' },
      { id: UUID, title: 'Aliens' },
    ])

    expect(merged).toHaveBeenCalledTimes(2)

    neode.off(EventType.NODE_MERGED, merged)
  })
})

describe('deleteAll fires the delete lifecycle per entity (NTS-596)', () => {
  it('emits NODE_DELETED for every deleted entity after beforeDelete', async () => {
    const neode = new Neode(new FakeProvider())

    const order: string[] = []
    neode.observe(Movie, {
      beforeDelete: () => order.push('before'),
      afterDelete: () => order.push('after'),
    })

    const deleted = vi.fn()
    neode.on(EventType.NODE_DELETED, deleted)

    const count = await neode.deleteAll(Movie, { title: 'Alien' })

    expect(count).toBe(2)
    expect(deleted).toHaveBeenCalledTimes(2)
    // Every entity: beforeDelete before the delete, NODE_DELETED + afterDelete after
    expect(order).toEqual(['before', 'before', 'after', 'after'])

    neode.off(EventType.NODE_DELETED, deleted)
  })

  it('a beforeDelete error fails the whole delete', async () => {
    const provider = new FakeProvider()
    const neode = new Neode(provider)

    neode.observe(Movie, {
      beforeDelete: () => {
        throw new Error('protected')
      },
    })

    await expect(neode.deleteAll(Movie, { title: 'Alien' })).rejects.toThrow('protected')

    expect(provider.statements.some((statement) => statement.includes('DETACH DELETE'))).toBe(false)
  })
})

describe('soft deletes emit NODE_UPDATED, not NODE_DELETED (NTS-596)', () => {
  it('the facade delete() of a @SoftDelete model updates', async () => {
    const neode = new Neode(new FakeProvider())

    const deleted = vi.fn()
    const updated = vi.fn()
    neode.on(EventType.NODE_DELETED, deleted)
    neode.on(EventType.NODE_UPDATED, updated)

    const afterDelete = vi.fn()
    neode.observe(SoftProduct, { afterDelete: afterDelete })

    const entity = Object.assign(new SoftProduct(), { sku: 'p1' })
    await neode.delete(entity)

    expect(deleted).not.toHaveBeenCalled()
    expect(updated).toHaveBeenCalledTimes(1)
    expect(updated.mock.calls[0][0]).toBe(entity)
    expect(afterDelete).toHaveBeenCalledTimes(1) // the soft-delete hook contract stands

    neode.off(EventType.NODE_DELETED, deleted)
    neode.off(EventType.NODE_UPDATED, updated)
  })
})

describe('label writes fire the save lifecycle (NTS-596)', () => {
  it('applyLabel emits NODE_UPDATED with the re-hydrated entity', async () => {
    const neode = new Neode(new FakeProvider())

    const updated = vi.fn()
    neode.on(EventType.NODE_UPDATED, updated)

    const after: unknown[] = []
    neode.observe(Movie, { afterSave: (entity) => after.push(entity) })

    const saved = await neode.applyLabel(
      Object.assign(new Movie(), { _id: ELEMENT_ID, id: UUID, title: 'Alien' }),
      'Archived',
      'SET',
    )

    expect(saved?.title).toBe('Alien')
    expect(updated).toHaveBeenCalledTimes(1)
    expect(after).toHaveLength(1)

    neode.off(EventType.NODE_UPDATED, updated)
  })
})

describe('transaction scope mirrors (NTS-596)', () => {
  it('tx.update buffers NODE_UPDATED until commit', async () => {
    const neode = new Neode(new FakeProvider())
    const updated = vi.fn()
    neode.on(EventType.NODE_UPDATED, updated)

    const tx = await neode.openWriteTransaction()
    await tx.update(Object.assign(new Movie(), { _id: ELEMENT_ID, id: UUID, title: 'Alien' }), {
      title: 'Aliens',
    })

    expect(updated).not.toHaveBeenCalled()

    await tx.commit()

    expect(updated).toHaveBeenCalledTimes(1)

    neode.off(EventType.NODE_UPDATED, updated)
  })

  it('tx.merge buffers NODE_MERGED until commit', async () => {
    const neode = new Neode(new FakeProvider())
    const merged = vi.fn()
    neode.on(EventType.NODE_MERGED, merged)

    const tx = await neode.openWriteTransaction()
    await tx.merge(Movie, { id: UUID, title: 'Alien' })

    expect(merged).not.toHaveBeenCalled()

    await tx.commit()

    expect(merged).toHaveBeenCalledTimes(1)

    neode.off(EventType.NODE_MERGED, merged)
  })

  it('tx.delete of a @SoftDelete model emits NODE_UPDATED, not NODE_DELETED', async () => {
    const neode = new Neode(new FakeProvider())
    const deleted = vi.fn()
    const updated = vi.fn()
    neode.on(EventType.NODE_DELETED, deleted)
    neode.on(EventType.NODE_UPDATED, updated)

    const tx = await neode.openWriteTransaction()
    await tx.delete(Object.assign(new SoftProduct(), { sku: 'p1' }))
    await tx.commit()

    expect(deleted).not.toHaveBeenCalled()
    expect(updated).toHaveBeenCalledTimes(1)

    neode.off(EventType.NODE_DELETED, deleted)
    neode.off(EventType.NODE_UPDATED, updated)
  })
})

describe('hook errors never suppress emission (NTS-596)', () => {
  it('an afterDelete error surfaces after commit; NODE_DELETED was already emitted', async () => {
    const neode = new Neode(new FakeProvider())

    const order: string[] = []
    neode.on(EventType.NODE_DELETED, () => order.push('event'))
    neode.observe(Movie, {
      afterDelete: () => {
        order.push('observer')
        throw new Error('hook boom')
      },
    })

    await expect(
      neode.delete(Object.assign(new Movie(), { id: UUID, title: 'Alien' })),
    ).rejects.toThrow('hook boom')

    expect(order).toEqual(['event', 'observer'])
  })
})
