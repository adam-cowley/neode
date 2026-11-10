import { openBackend, TestBackend } from './support/backend'
import { TransactionError } from '../../src/transaction/errors'

describe('runAll', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('runs every statement in one transaction and returns one result per statement', async () => {
    const results = await backend.neode.runAll([
      'CREATE (n:BatchItem { name: "a" }) RETURN n.name AS name',
      {
        query: 'CREATE (n:BatchItem { name: $name }) RETURN n.name AS name',
        params: { name: 'b' },
      },
    ])

    expect(results).toHaveLength(2)
    expect(results[0].records[0].get('name')).toBe('a')
    expect(results[1].records[0].get('name')).toBe('b')

    // The transaction was committed: the nodes are visible afterwards
    const count = await backend.neode.readCypher('MATCH (n:BatchItem) RETURN count(n) AS n')

    expect(count.records[0].get('n')).toBe(2)
  })

  it('rolls back every statement and throws a TransactionError when one fails', async () => {
    const error: TransactionError = await backend.neode
      .runAll([
        'CREATE (n:BatchFail { name: "first" })',
        'RETURN undefinedVariable',
        'CREATE (n:BatchFail { name: "third" })',
      ])
      .then(
        () => {
          throw new Error('runAll should have failed')
        },
        (e) => e,
      )

    expect(error).toBeInstanceOf(TransactionError)

    // Per-statement errors aligned with the batch: the first statement
    // succeeded, the second failed
    expect(error.errors[0]).toBeNull()
    expect(error.errors[1]).toBeTruthy()
    expect(error.details[0]?.index).toBe(1)
    expect(error.details[0]?.query).toBe('RETURN undefinedVariable')
    expect(error.message).toContain('1')

    // The one result produced before the failure is kept
    expect(error.results).toHaveLength(1)

    // Nothing was persisted: the whole batch rolled back
    const count = await backend.neode.readCypher('MATCH (n:BatchFail) RETURN count(n) AS n')

    expect(count.records[0].get('n')).toBe(0)
  })
})
