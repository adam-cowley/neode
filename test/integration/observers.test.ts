import { NodeEntity, Property, Primary, observe, clearObservers } from '../../src/index'
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
