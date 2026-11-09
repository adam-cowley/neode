import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { openBackend, TestBackend } from './support/backend'
import { setDefaultNeode } from '../../src/entity-methods'
import { Derived, NodeEntity, Number, OneToOne, Primary, Property } from '../../src/decorators'
import { Direction } from '../../src/query'

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

/** NTS-597: nested-create pipeline fixture */
@NodeEntity()
class Nested597Child {
  @Primary()
  @Property({ type: 'string', unique: true })
  key!: string

  @Property({ type: 'number' })
  a?: number

  @Property({ type: 'number' })
  b?: number

  @Property({ type: 'number' })
  @Derived({
    from: ['a', 'b'],
    compute: (entity) =>
      typeof entity['a'] === 'number' && typeof entity['b'] === 'number'
        ? (entity['a'] as number) + (entity['b'] as number)
        : undefined,
  })
  sum?: number
}

@NodeEntity()
class Nested597Parent {
  @OneToOne({ type: 'CHILD_OF', target: () => Nested597Child, direction: Direction.OUTGOING })
  child?: Nested597Child
}

/** NTS-597: increment-recompute fixture */
@NodeEntity()
class Counter597 {
  @Primary()
  @Property({ type: 'number', unique: true })
  id!: number

  @Property({ type: 'number' })
  hits?: number

  @Property({ type: 'number' })
  @Derived({ from: ['hits'], cypher: 'this.hits * 2' })
  doubleHits?: number

  @Property({ type: 'number' })
  @Derived({ from: ['hits'], compute: (entity) => (entity['hits'] as number) + 1 })
  hitsPlus?: number
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

  // NTS-597: nested targets take the full create pipeline
  it('create() derives the nested relationship target too', async () => {
    await backend.neode.create(Nested597Parent, {
      child: { key: 'n597-nested', a: 10, b: 5 },
    })

    const child = await backend.neode.find(Nested597Child, 'n597-nested')

    expect(child?.sum).toBe(15)
  })

  // NTS-597: increment recomputes a derived property over the counter
  it('increment() recomputes derived properties whose source is the counter', async () => {
    const repository = backend.neode.getRepository(Counter597)

    const created = await backend.neode.create(Counter597, { id: 1, hits: 0 })

    expect(await repository.increment(created, 'hits', 5)).toBe(5)

    const found = await backend.neode.find(Counter597, 1)

    // cypher-side: evaluated in the increment statement itself
    expect(found?.doubleHits).toBe(10)
    // compute-side: recomputed from the post-write node
    expect(found?.hitsPlus).toBe(6)
  })
})
