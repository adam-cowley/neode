import {
  NodeEntity,
  Property,
  Primary,
  SoftDelete,
  defineModel,
  extendModel,
  observe,
  clearObservers,
  EventType,
  Neode,
} from '../../src/index'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Observed {
  @Primary()
  @Property({ type: 'string' })
  sku!: string

  @Property({ type: 'number', min: 0 })
  price!: number

  static create(sku: string, price: number): Observed {
    const observed = new Observed()
    observed.sku = sku
    observed.price = price

    return observed
  }
}

@NodeEntity()
@SoftDelete() // label defaults to 'Deleted'
class SoftObserved {
  @Primary()
  @Property({ type: 'string' })
  sku!: string
}

// Map-API models for the extend() lineage: the clone gains an extra label
const ObserverBase = defineModel('ObserverBase', {
  sku: { type: 'string', unique: true },
  name: { type: 'string' },
})

const ObserverClone = extendModel('ObserverBase', 'ObserverClone', {})

// ---------------------------------------------------------------------------

describe('Observers (NTS-511)', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    clearObservers()
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('afterSave sees the created entity with isNew', async () => {
    const seen: { sku: string; isNew: boolean }[] = []

    backend.neode.observe(Observed, {
      afterSave: (entity, context) => {
        seen.push({ sku: (entity as Observed).sku, isNew: context.isNew })
      },
    })

    await backend.neode.create(Observed, { sku: 'a-1', price: 10 })

    expect(seen).toEqual([{ sku: 'a-1', isNew: true }])
  })

  it('beforeSave runs inside the write and can mutate the entity', async () => {
    backend.neode.observe(Observed, {
      beforeSave: (entity) => {
        ;(entity as Observed).price = 999
      },
    })

    const saved = await backend.neode.create(Observed, { sku: 'a-2', price: 10 })

    expect(saved.price).toBe(999)
  })

  it('a beforeSave error fails the write', async () => {
    backend.neode.observe(Observed, {
      beforeSave: () => {
        throw new Error('nope')
      },
    })

    await expect(backend.neode.create(Observed, { sku: 'a-3', price: 10 })).rejects.toThrow('nope')

    const output = await backend.neode.readCypher(
      'MATCH (o:Observed { sku: "a-3" }) RETURN count(o) AS count',
      {},
    )

    expect(Number(output.records[0]?.get('count'))).toBe(0)
  })

  it('beforeDelete can block the delete', async () => {
    backend.neode.observe(Observed, {
      beforeDelete: () => {
        throw new Error('protected')
      },
    })

    const created = await backend.neode.create(Observed, { sku: 'a-4', price: 10 })

    await expect(backend.neode.delete(created)).rejects.toThrow('protected')

    const output = await backend.neode.readCypher(
      'MATCH (o:Observed { sku: "a-4" }) RETURN count(o) AS count',
      {},
    )

    expect(Number(output.records[0]?.get('count'))).toBe(1)
  })

  it('afterDelete fires on a hard delete', async () => {
    const deleted: string[] = []

    backend.neode.observe(Observed, {
      afterDelete: (entity) => {
        deleted.push((entity as Observed).sku)
      },
    })

    const created = await backend.neode.create(Observed, { sku: 'a-5', price: 10 })
    await backend.neode.delete(created)

    expect(deleted).toEqual(['a-5'])
  })

  it('the off function detaches the observer', async () => {
    const calls: number[] = []

    const off = observe(Observed, {
      afterSave: () => {
        calls.push(1)
      },
    })

    off()
    await backend.neode.create(Observed, { sku: 'a-6', price: 10 })

    expect(calls).toEqual([])
  })

  it('observers run inside open transactions too', async () => {
    const seen: string[] = []

    backend.neode.observe(Observed, {
      beforeSave: (entity) => {
        seen.push((entity as Observed).sku)
      },
    })

    const tx = await backend.neode.openWriteTransaction()

    await tx.save(Observed.create('a-7', 10))

    expect(seen).toEqual(['a-7'])

    await tx.commit()
  })

  it('observing an unregistered model throws', () => {
    class Ghost {
      sku = ''
    }

    expect(() => backend.neode.observe(Ghost, {})).toThrow(/unregistered/i)
  })
})

describe('Observers fire on every write path (NTS-596)', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    clearObservers()
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('update() emits NODE_UPDATED with the re-hydrated entity and afterSave(isNew: false)', async () => {
    const updated: unknown[] = []
    const after: { isNew: boolean }[] = []

    backend.neode.on(EventType.NODE_UPDATED, (entity) => updated.push(entity))
    backend.neode.observe(Observed, {
      afterSave: (_entity, context) => after.push({ isNew: context.isNew }),
    })

    const created = await backend.neode.create(Observed, { sku: 'u-1', price: 10 })
    await backend.neode.update(created, { price: 20 })

    expect(updated).toHaveLength(1)
    expect(updated[0]).toBeInstanceOf(Observed)
    expect((updated[0] as Observed).price).toBe(20)
    expect(after.slice(1)).toEqual([{ isNew: false }]) // slice(1): skip the create's afterSave
  })

  it('entity.update() emits NODE_UPDATED', async () => {
    const updated: unknown[] = []

    backend.neode.on(EventType.NODE_UPDATED, (entity) => updated.push(entity))

    const created = await backend.neode.create(Observed, { sku: 'u-2', price: 10 })
    await created.update({ price: 30 })

    expect(updated).toHaveLength(1)
    expect((updated[0] as Observed).price).toBe(30)
  })

  it('a beforeSave error fails update() before the write', async () => {
    backend.neode.observe(Observed, {
      beforeSave: (_entity, context) => {
        // The create path also runs beforeSave — only the update must fail
        if (context.isNew) {
          return
        }

        throw new Error('no update')
      },
    })

    const created = await backend.neode.create(Observed, { sku: 'u-3', price: 10 })

    await expect(backend.neode.update(created, { price: 20 })).rejects.toThrow('no update')

    const output = await backend.neode.readCypher(
      'MATCH (o:Observed { sku: "u-3" }) RETURN o.price AS price',
      {},
    )

    expect(Number(output.records[0]?.get('price'))).toBe(10)
  })

  it('mergeOn() emits NODE_MERGED; merge() and Repository#upsert ride it', async () => {
    const merged: string[] = []

    backend.neode.on(EventType.NODE_MERGED, (entity) => {
      merged.push((entity as Observed).sku)
    })

    await backend.neode.mergeOn(Observed, { sku: 'm-1' }, { price: 5 })
    expect(merged).toEqual(['m-1'])

    await backend.neode.merge(Observed, { sku: 'm-1', price: 6 })
    expect(merged).toEqual(['m-1', 'm-1'])

    const repo = backend.neode.getRepository(Observed)
    await repo.upsert({ sku: 'm-2', price: 7 })
    expect(merged).toEqual(['m-1', 'm-1', 'm-2'])
  })

  it('createMany emits NODE_CREATED per row; mergeMany emits NODE_MERGED per row', async () => {
    const created: string[] = []
    const merged: string[] = []

    backend.neode.on(EventType.NODE_CREATED, (entity) => {
      created.push((entity as Observed).sku)
    })
    backend.neode.on(EventType.NODE_MERGED, (entity) => {
      merged.push((entity as Observed).sku)
    })

    await backend.neode.createMany(Observed, [
      { sku: 'b-1', price: 1 },
      { sku: 'b-2', price: 2 },
    ])
    expect(created.sort()).toEqual(['b-1', 'b-2'])

    await backend.neode.mergeMany(Observed, [{ sku: 'b-1', price: 10 }])
    expect(merged).toEqual(['b-1'])
  })

  it('deleteAll emits NODE_DELETED per deleted entity and beforeDelete can block it', async () => {
    const deleted: string[] = []

    backend.neode.on(EventType.NODE_DELETED, (entity) => {
      deleted.push((entity as Observed).sku)
    })

    await backend.neode.createMany(Observed, [
      { sku: 'd-1', price: 1 },
      { sku: 'd-2', price: 2 },
    ])

    const count = await backend.neode.deleteAll(Observed, { sku: 'd-1' })
    expect(count).toBe(1)
    expect(deleted).toEqual(['d-1'])

    // A beforeDelete error stops the whole bulk delete
    backend.neode.observe(Observed, {
      beforeDelete: () => {
        throw new Error('protected')
      },
    })

    await expect(backend.neode.deleteAll(Observed, { sku: 'd-2' })).rejects.toThrow('protected')

    const output = await backend.neode.readCypher('MATCH (o:Observed) RETURN count(o) AS count', {})

    expect(Number(output.records[0]?.get('count'))).toBe(1)
  })

  it('addLabel/removeLabel emit NODE_UPDATED and run the save hooks', async () => {
    const updated: unknown[] = []
    const after: number[] = []

    backend.neode.on(EventType.NODE_UPDATED, (entity) => updated.push(entity))
    backend.neode.observe(Observed, { afterSave: () => after.push(1) })

    const created = await backend.neode.create(Observed, { sku: 'l-1', price: 10 })

    await created.addLabel('Archived')
    expect(updated).toHaveLength(1)
    expect(after).toHaveLength(2) // the create's afterSave + the label write's

    const readAfterSet = await backend.neode.readCypher(
      'MATCH (o:Observed { sku: "l-1" }) RETURN labels(o) AS labels',
      {},
    )

    expect(
      (readAfterSet.records[0]?.get('labels') as unknown as string[]).includes('Archived'),
    ).toBe(true)

    await created.removeLabel('Archived')
    expect(updated).toHaveLength(2)
    expect(after).toHaveLength(3) // create + addLabel + removeLabel

    const readAfterRemove = await backend.neode.readCypher(
      'MATCH (o:Observed { sku: "l-1" }) RETURN labels(o) AS labels',
      {},
    )

    expect(
      (readAfterRemove.records[0]?.get('labels') as unknown as string[]).includes('Archived'),
    ).toBe(false)
  })

  it('a @SoftDelete delete() emits NODE_UPDATED, not NODE_DELETED', async () => {
    const deleted: unknown[] = []
    const updated: unknown[] = []
    const afterDelete: number[] = []

    backend.neode.on(EventType.NODE_DELETED, (entity) => deleted.push(entity))
    backend.neode.on(EventType.NODE_UPDATED, (entity) => updated.push(entity))
    backend.neode.observe(SoftObserved, { afterDelete: () => afterDelete.push(1) })

    const created = await backend.neode.create(SoftObserved, { sku: 's-1' })
    await backend.neode.delete(created)

    expect(deleted).toEqual([]) // the node survives
    expect(updated).toHaveLength(1)
    expect(afterDelete).toHaveLength(1) // the documented soft-delete hook contract

    const output = await backend.neode.readCypher(
      'MATCH (s:SoftObserved { sku: "s-1" }) RETURN labels(s) AS labels',
      {},
    )

    expect((output.records[0]?.get('labels') as unknown as string[]).includes('Deleted')).toBe(true)
  })

  it('entity.delete({ soft }) fires the delete hooks + NODE_UPDATED and returns the refreshed entity', async () => {
    const events: string[] = []

    backend.neode.on(EventType.NODE_DELETED, () => events.push('deleted'))
    backend.neode.on(EventType.NODE_UPDATED, () => events.push('updated'))
    backend.neode.observe(Observed, {
      beforeDelete: () => events.push('beforeDelete'),
      afterDelete: () => events.push('afterDelete'),
    })

    const created = await backend.neode.create(Observed, { sku: 's-2', price: 10 })

    await created.delete({ soft: 'Archived' })

    expect(events).toEqual(['beforeDelete', 'updated', 'afterDelete'])

    const output = await backend.neode.readCypher(
      'MATCH (o:Observed { sku: "s-2" }) RETURN labels(o) AS labels',
      {},
    )

    expect((output.records[0]?.get('labels') as unknown as string[]).includes('Archived')).toBe(
      true,
    )
  })

  it('observers on the base model fire for extend() clones', async () => {
    const before: unknown[] = []

    backend.neode.observe(ObserverBase, { beforeSave: (entity) => before.push(entity) })

    const clone = new ObserverClone()
    clone.sku = 'x-1'
    clone.name = 'Clone'

    const saved = await backend.neode.save(clone)

    expect(before).toHaveLength(1)

    const output = await backend.neode.readCypher(
      'MATCH (c:ObserverClone { sku: "x-1" }) RETURN labels(c) AS labels',
      {},
    )

    expect((output.records[0]?.get('labels') as unknown as string[]).includes('ObserverBase')).toBe(
      true,
    )
    expect(saved).toBeInstanceOf(ObserverClone)
  })

  it('observers are scoped per Neode instance', async () => {
    const other = new Neode(backend.connection)
    const onFirst: string[] = []
    const onSecond: string[] = []

    backend.neode.observe(Observed, { afterSave: () => onFirst.push('first') })
    other.observe(Observed, { afterSave: () => onSecond.push('second') })

    await backend.neode.create(Observed, { sku: 'p-1', price: 1 })

    expect(onFirst).toEqual(['first'])
    expect(onSecond).toEqual([])
  })

  it('an afterSave error surfaces after the commit and never suppresses NODE_UPDATED', async () => {
    const order: string[] = []

    backend.neode.on(EventType.NODE_UPDATED, () => order.push('event'))
    backend.neode.observe(Observed, {
      afterSave: (_entity, context) => {
        // The create's afterSave is fine; the UPDATE's hook fails
        if (context.isNew) {
          return
        }

        order.push('observer')
        throw new Error('hook boom')
      },
    })

    const created = await backend.neode.create(Observed, { sku: 'e-1', price: 10 })

    await expect(backend.neode.update(created, { price: 20 })).rejects.toThrow('hook boom')

    expect(order).toEqual(['event', 'observer'])

    // The data stayed committed
    const output = await backend.neode.readCypher(
      'MATCH (o:Observed { sku: "e-1" }) RETURN o.price AS price',
      {},
    )

    expect(Number(output.records[0]?.get('price'))).toBe(20)
  })
})
