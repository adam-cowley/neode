// The backend import loads neode.service first, resolving the module cycles
// before anything below is evaluated
import { openBackend, TestBackend } from './support/backend'
import { Builder } from '../../src/query'

// NTS-561 — managed transactions: in*Transaction commits on success, so a
// callback that forgets tx.commit() no longer leaks an open transaction
// (which deadlocked the next write on the embedded engine)
describe('managed transactions — commit on success — integration', () => {
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

  const count = async (name: string): Promise<number> => {
    const found = await backend.neode.read(
      new Builder().match('p', 'ManagedTxPerson').where('p.name', name).return('count(p) AS c'),
    )

    return Number(found.records[0].get('c'))
  }

  it('success without an explicit commit persists and leaves no leaked transaction', async () => {
    await backend.neode.inWriteTransaction(async (tx) => {
      await tx.write(new Builder().create('p', 'ManagedTxPerson', { name: 'Auto' }))

      return null
    })

    expect(await count('Auto')).toBe(1)

    // The deadlock regression: a leaked open transaction blocks the next
    // write on the same connection — this only passes when the first
    // transaction was actually committed
    await backend.neode.inWriteTransaction(async (tx) => {
      await tx.write(new Builder().create('p', 'ManagedTxPerson', { name: 'Second' }))

      return null
    })

    expect(await count('Second')).toBe(1)
  })

  it('success with an explicit commit persists exactly once', async () => {
    await backend.neode.inWriteTransaction(async (tx) => {
      await tx.write(new Builder().create('p', 'ManagedTxPerson', { name: 'Explicit' }))

      await tx.commit()

      return null
    })

    expect(await count('Explicit')).toBe(1)
  })

  it('a throw after an explicit commit keeps the commit (no rollback error)', async () => {
    await expect(
      backend.neode.inWriteTransaction(async (tx) => {
        await tx.write(new Builder().create('p', 'ManagedTxPerson', { name: 'Survivor' }))

        await tx.commit()

        throw new Error('after commit')
      }),
    ).rejects.toThrow('after commit')

    // The commit stands — the work is not rolled back
    expect(await count('Survivor')).toBe(1)
  })

  it('inReadTransaction releases the transaction on success', async () => {
    await backend.neode.write('CREATE (:ManagedTxPerson { name: "Read" })')

    const names = await backend.neode.inReadTransaction(async (tx) => {
      const output = await tx.read(
        new Builder().match('p', 'ManagedTxPerson').return('p.name AS name'),
      )

      return output.records.map((record) => String(record.get('name')))
    })

    expect(names).toContain('Read')

    // The read transaction was released: a write succeeds on the same connection
    await backend.neode.write('CREATE (:ManagedTxPerson { name: "AfterRead" })')

    expect(await count('AfterRead')).toBe(1)
  })
})
