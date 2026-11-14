import { describe, expect, it, vi } from 'vitest'
import { NodeEntity, Primary, Property } from '../../src/decorators'
import { Neode } from '../../src/neode.service'
import { EventType } from '../../src/common/events'
import { NeodeError, TransientError } from '../../src/errors'
import { classifyError, isRetryableError } from '../../src/errors/classify'
import { clearObservers, observe } from '../../src/observers'
import type { ConnectionProvider, QueryOutput, TransactionHandle } from '../../src/driver/types'

// ---- Fixtures --------------------------------------------------------------

@NodeEntity()
class TxPerson {
  @Primary()
  @Property({ type: 'string' })
  name!: string
}

function codedError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

// A provider whose transactions record their lifecycle; `failRun` / `failCommit`
// are consumed per attempt (a queue), and every attempt gets a fresh handle
class MockProvider implements ConnectionProvider {
  begins: { mode: string | undefined; database: string | undefined }[] = []
  commits = 0
  rollbacks = 0
  runFailures: (Error | undefined)[] = []
  commitFailures: (Error | undefined)[] = []

  async run(query?: string): Promise<QueryOutput> {
    // NTS-634: the guarded delete statement ends RETURN count(...) — the
    // fake plays the database: one row, the delete happened
    if (query?.includes('count(this) AS deleted') === true) {
      return {
        records: [
          {
            get: (name: string) => (name === 'deleted' ? 1 : undefined),
            has: (name: string) => name === 'deleted',
            keys: ['deleted'],
          },
        ],
      }
    }

    return { records: [] }
  }

  async beginTransaction(mode?: string, database?: string): Promise<TransactionHandle> {
    this.begins.push({ mode, database })

    const runFailure = this.runFailures.shift()
    const commitFailure = this.commitFailures.shift()

    return {
      run: async (statement?: string) => {
        if (runFailure) {
          throw runFailure
        }

        // NTS-634: the guarded delete statement ends RETURN count(...) —
        // the fake plays the database: one row, the delete happened
        if (statement?.includes('count(this) AS deleted') === true) {
          return {
            records: [
              {
                get: (name: string) => (name === 'deleted' ? 1 : undefined),
                has: (name: string) => name === 'deleted',
                keys: ['deleted'],
              },
            ],
          }
        }

        return { records: [] }
      },
      commit: async () => {
        if (commitFailure) {
          throw commitFailure
        }

        this.commits++
      },
      rollback: async () => {
        this.rollbacks++
      },
    }
  }

  async edition() {
    return 'community' as const
  }

  async close() {}
}

const TRANSIENT = 'Neo.TransientError.Transaction.DeadlockDetected'

describe('retry predicate (NTS-582)', () => {
  it('retries transient codes but not Terminated / LockClientStopped', () => {
    expect(isRetryableError(classifyError(codedError(TRANSIENT)))).toBe(true)
    expect(
      isRetryableError(classifyError(codedError('Neo.TransientError.Transaction.Terminated'))),
    ).toBe(false)
    expect(
      isRetryableError(
        classifyError(codedError('Neo.TransientError.Transaction.LockClientStopped')),
      ),
    ).toBe(false)
    expect(isRetryableError(new Error('plain'))).toBe(false)
  })

  it('transaction() does not retry a terminated transaction', async () => {
    const provider = new MockProvider()
    const neode = new Neode(provider)

    provider.runFailures = [codedError('Neo.TransientError.Transaction.Terminated')]

    await expect(
      neode.transaction(async (tx) => tx.getTransaction().run('RETURN 1')),
    ).rejects.toBeInstanceOf(TransientError)

    expect(provider.begins).toHaveLength(1)
  })

  it('transaction() retries a plain transient failure', async () => {
    const provider = new MockProvider()
    const neode = new Neode(provider)

    provider.runFailures = [codedError(TRANSIENT)]

    await neode.transaction(async (tx) => tx.getTransaction().run('RETURN 1'))

    expect(provider.begins).toHaveLength(2)
    expect(provider.commits).toBe(1)
  })
})

describe('commit-phase failures (NTS-582)', () => {
  it('are not retried by default', async () => {
    const provider = new MockProvider()
    const neode = new Neode(provider)
    const work = vi.fn(async () => 'done')

    provider.commitFailures = [codedError(TRANSIENT)]

    await expect(neode.transaction(work)).rejects.toBeInstanceOf(TransientError)

    expect(work).toHaveBeenCalledTimes(1)
    expect(provider.begins).toHaveLength(1)
  })

  it('are retried with retryCommit: true', async () => {
    const provider = new MockProvider()
    const neode = new Neode(provider)
    const work = vi.fn(async () => 'done')

    provider.commitFailures = [codedError(TRANSIENT)]

    await expect(neode.transaction(work, { retryCommit: true })).resolves.toBe('done')

    expect(work).toHaveBeenCalledTimes(2)
  })
})

describe('events and observers fire after commit (NTS-582)', () => {
  it('buffers DELETED events until the transaction commits', async () => {
    const provider = new MockProvider()
    const neode = new Neode(provider)
    const seen: string[] = []
    const entity = Object.assign(new TxPerson(), { name: 'Ada' })

    neode.on(EventType.NODE_DELETED, () => seen.push('event'))

    await neode.transaction(async (tx) => {
      await tx.delete(entity)

      expect(seen).toEqual([])
    })

    expect(seen).toEqual(['event'])
  })

  it('discards the events of a retried attempt', async () => {
    const provider = new MockProvider()
    const neode = new Neode(provider)
    const entity = Object.assign(new TxPerson(), { name: 'Ada' })
    const events = vi.fn()
    let attempt = 0

    neode.on(EventType.NODE_DELETED, events)

    // First attempt: the write succeeds, then a statement fails transiently
    provider.runFailures = [undefined]

    await neode.transaction(async (tx) => {
      attempt++
      await tx.delete(entity)

      if (attempt === 1) {
        throw classifyError(codedError(TRANSIENT))
      }
    })

    expect(attempt).toBe(2)
    expect(events).toHaveBeenCalledTimes(1)
  })

  it('drops events and afterDelete observers on rollback', async () => {
    const provider = new MockProvider()
    const neode = new Neode(provider)
    const entity = Object.assign(new TxPerson(), { name: 'Ada' })
    const events = vi.fn()
    const after = vi.fn()

    neode.on(EventType.NODE_DELETED, events)

    const off = observe(TxPerson, { afterDelete: after })

    await expect(
      neode.transaction(async (tx) => {
        await tx.delete(entity)

        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    off()
    clearObservers()

    expect(events).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })

  it('flushes on commit() of a plain transaction handle, not before', async () => {
    const provider = new MockProvider()
    const neode = new Neode(provider)
    const entity = Object.assign(new TxPerson(), { name: 'Ada' })
    const events = vi.fn()

    neode.on(EventType.NODE_DELETED, events)

    const tx = await neode.openWriteTransaction()

    await tx.delete(entity)

    expect(events).not.toHaveBeenCalled()

    await tx.commit()

    expect(events).toHaveBeenCalledTimes(1)
  })

  it('drops the events of a rolled-back transaction handle', async () => {
    const provider = new MockProvider()
    const neode = new Neode(provider)
    const entity = Object.assign(new TxPerson(), { name: 'Ada' })
    const events = vi.fn()

    neode.on(EventType.NODE_DELETED, events)

    const tx = await neode.openWriteTransaction()

    await tx.delete(entity)
    await tx.rollback()

    expect(events).not.toHaveBeenCalled()
  })
})

describe('failed close discards buffered events (NTS-582)', () => {
  it('a failed commit() on a handle never releases the events', async () => {
    const provider = new MockProvider()
    const neode = new Neode(provider)
    const entity = Object.assign(new TxPerson(), { name: 'Ada' })
    const events = vi.fn()

    neode.on(EventType.NODE_DELETED, events)

    provider.commitFailures = [new Error('commit failed')]

    const tx = await neode.openWriteTransaction()

    await tx.delete(entity)

    await expect(tx.commit()).rejects.toThrow('commit failed')

    expect(events).not.toHaveBeenCalled()
  })
})

describe('nested option conflicts (NTS-582)', () => {
  it('a nested transaction() with a conflicting option throws', async () => {
    const neode = new Neode(new MockProvider())

    await expect(
      neode.transaction(async () => neode.transaction(async () => 1, { routing: 'READ' })),
    ).rejects.toThrow(/routing 'READ'.*outermost transaction\(\)/)

    await expect(
      neode.transaction(async () => neode.transaction(async () => 1, { retries: 5 })),
    ).rejects.toBeInstanceOf(NeodeError)

    await expect(
      neode.transaction(async () => neode.transaction(async () => 1, { database: 'other' })),
    ).rejects.toThrow(/database 'other'/)
  })

  it('matching or absent options still join', async () => {
    const provider = new MockProvider()
    const neode = new Neode(provider)

    await neode.transaction(async () => neode.transaction(async () => 1, { routing: 'WRITE' }))

    expect(provider.begins).toHaveLength(1)
  })

  it('inWriteTransaction inside a READ transaction throws', async () => {
    const neode = new Neode(new MockProvider())

    await expect(
      neode.transaction(async () => neode.inWriteTransaction(async () => 1), { routing: 'READ' }),
    ).rejects.toThrow(/routing 'WRITE'/)
  })

  it('inReadTransaction with a different database throws', async () => {
    const neode = new Neode(new MockProvider())

    await expect(
      neode.transaction(async () => neode.inReadTransaction(async () => 1, 'other')),
    ).rejects.toThrow(/database 'other'/)
  })
})

describe('finished scopes (NTS-582)', () => {
  it('a joined call after the callback resolved throws a clear error', async () => {
    const neode = new Neode(new MockProvider())
    let detached: Promise<unknown> = Promise.resolve()

    await neode.transaction(async () => {
      detached = new Promise((resolve) => {
        setTimeout(() => {
          resolve(neode.inWriteTransaction(async (tx) => tx.getTransaction().run('RETURN 1')))
        }, 5)
      })
    })

    await expect(detached).rejects.toThrow(/already finished \(detached async work\?\)/)
  })
})

describe('rollback-only poison scope (NTS-589)', () => {
  it('a swallowed pure-JS failure in a joined call does not poison the transaction', async () => {
    const provider = new MockProvider()
    const neode = new Neode(provider)

    // The joined call fails before ANY statement reaches the driver
    // (save() rejects on the unregistered model in pure JS) and the error
    // escapes the joined work — the callback handles it, the transaction
    // is clean and commits
    const result = await neode.transaction(async () => {
      try {
        await neode.inWriteTransaction(async (tx) => {
          await tx.save({ nope: true })
        })
      } catch {
        // handled — nothing reached the driver, so the commit stands
      }

      return 'done'
    })

    expect(result).toBe('done')
    expect(provider.commits).toBe(1)
    expect(provider.rollbacks).toBe(0)
  })

  it('a swallowed statement failure in a joined call still marks rollback-only', async () => {
    const provider = new MockProvider()
    const neode = new Neode(provider)

    // The statement fails ON THE DRIVER and the error escapes the joined
    // work: the shared transaction may be rollback-only server-side, so
    // the handled error must still prevent the commit
    provider.runFailures = [new Error('driver boom')]

    await expect(
      neode.transaction(async () => {
        try {
          await neode.inWriteTransaction(async (tx) => {
            await tx.getTransaction().run('RETURN 1')
          })
        } catch {
          // handled — but the failed statement poisons the scope
        }
      }),
    ).rejects.toThrow('rollback-only')

    expect(provider.rollbacks).toBe(1)
    expect(provider.commits).toBe(0)
  })
})
