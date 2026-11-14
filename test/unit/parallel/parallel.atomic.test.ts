import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { ParallelError } from '../../../src/transaction/parallel.js'
import { Neode } from '../../../src/neode.service.js'
import { TransactionalService } from '../../../src/transaction/transactional.service.js'
import { FakeProvider } from './fakes.js'

describe('Neode#parallel — atomic mode (NTS-631)', () => {
  it('commits every opened transaction when all bodies succeed', async () => {
    const provider = new FakeProvider()
    const neode = new Neode(provider)

    const results = await neode.parallel(
      {
        a: async (scope) => {
          await scope.write('CREATE (:A)')

          return 'a'
        },
        b: async (scope) => {
          await scope.write('CREATE (:B)')

          return 'b'
        },
        c: async (scope) => {
          await scope.write('CREATE (:C)')

          return 'c'
        },
      },
      { mode: 'atomic' },
    )

    expect(results).toEqual({ a: 'a', b: 'b', c: 'c' })
    expect(provider.handles).toHaveLength(3)

    for (const handle of provider.handles) {
      expect(handle.committed).toBe(true)
      expect(handle.rolledBack).toBe(false)
    }
  })

  it('rolls back every opened transaction when one body fails', async () => {
    const boom = new Error('b failed')
    const provider = new FakeProvider()
    const neode = new Neode(provider)

    const caught: unknown = await neode
      .parallel(
        {
          a: async (scope) => {
            await scope.write('CREATE (:A)')

            return 'a'
          },
          b: async () => {
            throw boom
          },
          c: async (scope) => {
            await scope.write('CREATE (:C)')

            return 'c'
          },
        },
        { mode: 'atomic' },
      )
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(ParallelError)

    const error = caught as ParallelError

    // One WRITE transaction per operation was opened...
    expect(provider.handles).toHaveLength(3)

    // ...and every one of them was rolled back — nothing committed
    for (const handle of provider.handles) {
      expect(handle.rolledBack).toBe(true)
      expect(handle.committed).toBe(false)
    }

    expect(error.phase).toBe('body')
    expect(error.errors).toEqual([{ key: 'b', error: boom }])
    expect(error.cause).toBe(boom)
    expect(error.rollback?.rolledBack).toEqual(['a', 'b', 'c'])
    expect(error.rollback?.failures).toEqual([])
  })

  it('surfaces a commit-phase failure per handle and still commits the rest (residual risk)', async () => {
    const provider = new FakeProvider()
    provider.failCommitFor.add(1) // the second handle's commit fails
    const neode = new Neode(provider)

    const caught: unknown = await neode
      .parallel(
        {
          a: async (scope) => {
            await scope.write('CREATE (:A)')

            return 'a'
          },
          b: async (scope) => {
            await scope.write('CREATE (:B)')

            return 'b'
          },
        },
        { mode: 'atomic' },
      )
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(ParallelError)

    const error = caught as ParallelError

    expect(error.phase).toBe('commit')
    expect(error.errors.map((failure) => failure.key)).toEqual(['b'])
    expect(error.errors[0]?.error).toBeInstanceOf(Error)
    expect(error.rollback).toBeUndefined()

    // Commits continue past the failure — a's data stands
    expect(provider.handles.map((handle) => handle.committed)).toEqual([true, false])
  })

  it('rolls back all opened transactions when an operation reports several failures', async () => {
    const provider = new FakeProvider()
    const neode = new Neode(provider)

    const caught: unknown = await neode
      .parallel(
        {
          a: async () => {
            throw new Error('a failed')
          },
          b: async () => {
            throw new Error('b failed too')
          },
        },
        { mode: 'atomic' },
      )
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(ParallelError)

    const error = caught as ParallelError

    expect(error.errors.map((failure) => failure.key)).toEqual(['a', 'b'])
    // The first failure (input order) is the cause
    expect((error.cause as Error).message).toBe('a failed')
    expect(provider.handles.map((handle) => handle.rolledBack)).toEqual([true, true])
  })
})

describe('TransactionalService#parallel (NTS-631)', () => {
  it('rejects atomic mode — a scoped transaction cannot fan out', async () => {
    const provider = new FakeProvider()
    const handle = await provider.beginTransaction()
    const tx = new TransactionalService(handle, new EventEmitter())

    await expect(tx.parallel({ a: async () => 'a' }, { mode: 'atomic' })).rejects.toThrow(
      /cannot fan out/,
    )

    // Nothing was opened on the parent connection by the rejected call
    expect(provider.handles).toHaveLength(1)
  })

  it('delegates autocommit reads through the parent connection, outside the transaction', async () => {
    const provider = new FakeProvider()
    const handle = await provider.beginTransaction()
    const tx = new TransactionalService(
      handle,
      new EventEmitter(),
      undefined,
      true,
      undefined,
      provider,
    )

    const results = await tx.parallel({
      tiles: async (scope) => {
        await scope.read('RETURN 1')

        return 'tiles'
      },
    })

    expect(results).toEqual({ tiles: 'tiles' })
    expect(provider.autocommit).toEqual([['RETURN 1', 'READ']])

    // The scoped transaction handle was NOT used and NOT closed
    expect(handle.committed).toBe(false)
    expect(handle.rolledBack).toBe(false)
  })
})
