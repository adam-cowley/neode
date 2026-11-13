// The backend import loads neode.service first, resolving the
// query.service -> utils -> neode.service module cycle before the
// repository below is evaluated
import { openBackend, TestBackend } from './support/backend'
import {
  InternalId,
  NodeEntity,
  Number as NumberProperty,
  Property,
  UpdatedAt,
  Uuid,
  Version,
} from '../../src/decorators'
import { GuardViolationError } from '../../src/errors'
import { Repository } from '../../src/repository'

// ---- Fixtures (per-file: decorator registry is global per module) -----------

@NodeEntity()
class StockItem {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string

  @NumberProperty()
  unitsInStock: number

  @UpdatedAt()
  updatedAt: unknown

  @Version()
  version: number
}

// ---------------------------------------------------------------------------

describe('Repository#increment min floor (NTS-655)', () => {
  let backend: TestBackend

  const repository = (): Repository<StockItem, typeof StockItem> =>
    backend.neode.getRepository(StockItem)

  const readNode = async (id: string): Promise<Record<string, unknown>> => {
    const output = await backend.neode.readCypher(
      'MATCH (n:StockItem {id: $id}) RETURN n.unitsInStock AS stock, n.version AS version, toString(n.updatedAt) AS updatedAt',
      { id },
    )

    const record = output.records[0]

    if (record === undefined) {
      throw new Error(`StockItem ${id} not found`)
    }

    return Object.fromEntries(record.keys.map((key) => [key, record.get(key)]))
  }

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  const seed = (stock: number): Promise<StockItem> =>
    backend.neode.create(StockItem, { name: 'Chai', unitsInStock: stock })

  it('a guarded decrement to exactly the floor passes (inclusive)', async () => {
    const item = await seed(5)

    expect(await repository().increment(item, 'unitsInStock', -5, { min: 0 })).toBe(0)
    expect(await readNode(item.id)).toMatchObject({ stock: 0 })
  })

  it('a guarded decrement below the floor throws GuardViolationError', async () => {
    const item = await seed(3)

    await expect(repository().increment(item, 'unitsInStock', -4, { min: 0 })).rejects.toThrow(
      GuardViolationError,
    )

    // Autocommit: the SET itself still commits (documented) — the guard
    // closes the check-then-decrement race, the rollback is the ambient
    // transaction's job
    expect(await readNode(item.id)).toMatchObject({ stock: -1 })
  })

  it('a violation rolls the managed inWriteTransaction unit back (concurrent-style race)', async () => {
    const item = await seed(10)

    await expect(
      backend.neode.inWriteTransaction(async (tx) => {
        const repo = new Repository<StockItem>(tx, StockItem)

        // The winning racer's decrement lands (10 -> 7)...
        await repo.increment(item, 'unitsInStock', -3, { min: 0 })

        // ...the losing racer's would push the stock below the floor —
        // the guard throws and the whole unit rolls back
        return repo.increment(item, 'unitsInStock', -8, { min: 0 })
      }),
    ).rejects.toThrow(GuardViolationError)

    // Nothing survived: the seeded stock at version 0, untouched
    expect(await readNode(item.id)).toMatchObject({ stock: 10, version: 0 })
  })

  it('a successful guarded decrement still bumps version and updatedAt', async () => {
    const item = await seed(5)

    expect(await repository().increment(item, 'unitsInStock', -2, { min: 0 })).toBe(3)

    expect(await readNode(item.id)).toMatchObject({ stock: 3, version: 1 })
    // toString(datetime()) renders an ISO string — a missing stamp reads 'null'
    expect(String((await readNode(item.id)).updatedAt)).not.toBe('null')
  })

  it('a floor on a positive increment is a no-op guard', async () => {
    const item = await seed(5)

    expect(await repository().increment(item, 'unitsInStock', 5, { min: 0 })).toBe(10)
  })

  it('a missing entity raises the guard error too (the zero-row cases are indistinguishable)', async () => {
    await expect(repository().increment('nope', 'unitsInStock', -1, { min: 0 })).rejects.toThrow(
      GuardViolationError,
    )
  })

  it('rejects a non-finite min', async () => {
    const item = await seed(5)

    await expect(
      repository().increment(item, 'unitsInStock', -1, { min: Number.POSITIVE_INFINITY }),
    ).rejects.toThrow('min must be a finite number')
  })
})
