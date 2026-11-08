import { describe, expect, it, vi } from 'vitest'
import { Neode } from '../../src/neode.service'
import { NeodeError } from '../../src/errors'
import { ConnectionProvider, QueryOutput, TransactionHandle } from '../../src/driver/types'

// ---- A provider whose transactions succeed: every handle records its close calls

class RecordingProvider implements ConnectionProvider {
  readonly commit = vi.fn()
  readonly rollback = vi.fn()

  async run(): Promise<QueryOutput> {
    return { records: [] }
  }

  async beginTransaction(): Promise<TransactionHandle> {
    return {
      run: () => Promise.resolve({ records: [] }),
      commit: this.commit,
      rollback: this.rollback,
    }
  }

  async edition() {
    return 'community' as const
  }

  async close() {}
}

// NTS-561 — managed transactions: commit on success, rollback on throw
describe('managed transactions commit on success', () => {
  it('inWriteTransaction commits when the work does not', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    const result = await neode.inWriteTransaction(async () => 'done')

    expect(result).toBe('done')
    expect(provider.commit).toHaveBeenCalledTimes(1)
    expect(provider.rollback).not.toHaveBeenCalled()
  })

  it('inReadTransaction commits (releases) when the work does not', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    const result = await neode.inReadTransaction(async () => 'done')

    expect(result).toBe('done')
    expect(provider.commit).toHaveBeenCalledTimes(1)
    expect(provider.rollback).not.toHaveBeenCalled()
  })

  it('an explicit commit inside the work is not committed twice', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await neode.inWriteTransaction(async (tx) => {
      await tx.commit()

      return 'done'
    })

    expect(provider.commit).toHaveBeenCalledTimes(1)
    expect(provider.rollback).not.toHaveBeenCalled()
  })

  it('a throw after an explicit commit keeps the commit and does not roll back', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await expect(
      neode.inWriteTransaction(async (tx) => {
        await tx.commit()

        throw new Error('after commit')
      }),
    ).rejects.toThrow('after commit')

    expect(provider.commit).toHaveBeenCalledTimes(1)
    expect(provider.rollback).not.toHaveBeenCalled()
  })

  it('a throw without a commit still rolls back', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)

    await expect(
      neode.inWriteTransaction(async () => {
        throw new Error('force rollback')
      }),
    ).rejects.toThrow('force rollback')

    expect(provider.rollback).toHaveBeenCalledTimes(1)
    expect(provider.commit).not.toHaveBeenCalled()
  })
})

describe('TransactionalService close endpoints are safe to sequence', () => {
  it('a second commit() is a no-op', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)
    const tx = await neode.openWriteTransaction()

    await tx.commit()
    await expect(tx.commit()).resolves.toBeUndefined()

    expect(provider.commit).toHaveBeenCalledTimes(1)
  })

  it('rollback() after commit() is a no-op', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)
    const tx = await neode.openWriteTransaction()

    await tx.commit()
    await expect(tx.rollback()).resolves.toBeUndefined()

    expect(provider.rollback).not.toHaveBeenCalled()
  })

  it('commit() after rollback() throws (typed error)', async () => {
    const provider = new RecordingProvider()
    const neode = new Neode(provider)
    const tx = await neode.openWriteTransaction()

    await tx.rollback()

    await expect(tx.commit()).rejects.toThrow(NeodeError)
    await expect(tx.commit()).rejects.toThrow('already rolled back')
    expect(provider.commit).not.toHaveBeenCalled()
  })

  it('isSettled() flips on the first terminal operation', async () => {
    const neode = new Neode(new RecordingProvider())
    const tx = await neode.openWriteTransaction()

    expect(tx.isSettled()).toBe(false)

    await tx.rollback()

    expect(tx.isSettled()).toBe(true)
  })
})
