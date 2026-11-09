import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { openBackend, TestBackend } from './support/backend'
import { setDefaultNeode } from '../../src/entity-methods'
import { Derived, NodeEntity, Number, Primary, Property } from '../../src/decorators'

// ---- Fixtures (per-file: decorator registry is global per module) -----------

@NodeEntity()
class DerivedOrder {
  @Primary()
  @Property({ type: 'number', unique: true })
  id!: number

  @Property({ type: 'number' })
  a!: number

  @Property({ type: 'number' })
  b?: number

  /** TypeScript-side: stored sum, recomputed on the write path */
  @Property({ type: 'number' })
  @Derived({
    from: ['a', 'b'],
    compute: (entity) =>
      typeof entity['a'] === 'number' && typeof entity['b'] === 'number'
        ? (entity['a'] as number) + (entity['b'] as number)
        : undefined,
  })
  sum?: number

  /** Cypher-side: evaluated by the database in the write statement */
  @Property({ type: 'number' })
  @Derived({ from: ['a'], cypher: 'this.a * 2' })
  doubleA?: number
}

// ---------------------------------------------------------------------------

describe('stored derived properties (NTS-569)', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()

    setDefaultNeode(backend.neode)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('create() computes and stores both derivation flavors', async () => {
    const created = await backend.neode.create(DerivedOrder, { id: 1, a: 10, b: 5 })

    expect(created.sum).toBe(15)
    expect(created.doubleA).toBe(20)

    const found = await backend.neode.find(DerivedOrder, 1)

    expect(found?.sum).toBe(15)
    expect(found?.doubleA).toBe(20)
  })

  it('a create without every source stores no derived value', async () => {
    await backend.neode.create(DerivedOrder, { id: 2, a: 10 })

    const found = await backend.neode.find(DerivedOrder, 2)

    // b is absent: sum derives from a partial source set -> skipped;
    // doubleA is cypher-side: the database evaluates it off the node
    expect(found?.sum).toBeUndefined()
    expect(found?.doubleA).toBe(20)
  })

  it('a tracked save recomputes from the dirty source only', async () => {
    const created = await backend.neode.create(DerivedOrder, { id: 3, a: 10, b: 5 })

    created.b = 100
    await created.save()

    const found = await backend.neode.find(DerivedOrder, 3)

    expect(found?.sum).toBe(110)
    expect(found?.doubleA).toBe(20)
  })

  it('a tracked save recomputes the cypher-side flavor from its dirty source', async () => {
    const created = await backend.neode.create(DerivedOrder, { id: 8, a: 10, b: 5 })

    created.a = 50
    await created.save()

    const found = await backend.neode.find(DerivedOrder, 8)

    expect(found?.doubleA).toBe(100)
  })

  it('an explicitly set derived value wins over recomputation', async () => {
    const created = await backend.neode.create(DerivedOrder, { id: 4, a: 10, b: 5 })

    created.b = 100
    created.sum = -1
    await created.save()

    const found = await backend.neode.find(DerivedOrder, 4)

    expect(found?.sum).toBe(-1)
  })

  it('update() recomputes over the stored sources under the patch', async () => {
    const created = await backend.neode.create(DerivedOrder, { id: 5, a: 10, b: 5 })

    await created.update({ b: 1 })

    const found = await backend.neode.find(DerivedOrder, 5)

    expect(found?.sum).toBe(11)
    expect(found?.doubleA).toBe(20)
  })

  it('bulk createMany derives per row', async () => {
    await backend.neode.mergeMany(DerivedOrder, [
      { id: 6, a: 2, b: 3 },
      { id: 7, a: 4, b: 6 },
    ])

    const sixth = await backend.neode.find(DerivedOrder, 6)
    const seventh = await backend.neode.find(DerivedOrder, 7)

    expect(sixth?.sum).toBe(5)
    expect(sixth?.doubleA).toBe(4)
    expect(seventh?.sum).toBe(10)
    expect(seventh?.doubleA).toBe(8)
  })
})
