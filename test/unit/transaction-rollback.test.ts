import { describe, expect, it, vi } from 'vitest'
import { Neode } from '../../src/neode.service'
import { NodeEntity, Uuid, String } from '../../src/decorators'
import {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams,
  TransactionHandle,
} from '../../src/driver/types'
import { ValidationError } from '../../src/validation'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Leak {
  @Uuid({ primary: true })
  id: string

  @String()
  name: string
}

// ---- A provider whose queries blow up once a transaction is open ------------

class ExplodingProvider implements ConnectionProvider {
  readonly rollback = vi.fn()
  readonly commit = vi.fn()

  async run(): Promise<QueryOutput> {
    return { records: [] }
  }

  async beginTransaction(): Promise<TransactionHandle> {
    return {
      run: () => Promise.reject(new Error('boom: the statement failed')),
      commit: this.commit,
      rollback: this.rollback,
    }
  }

  async edition() {
    return 'community' as const
  }

  async close() {}
}

describe('failed statements roll their transaction back (no leaked transactions)', () => {
  it('find() rolls back and rethrows when the read fails', async () => {
    const provider = new ExplodingProvider()
    const neode = new Neode(provider)

    await expect(neode.find(Leak, 'x')).rejects.toThrow('boom: the statement failed')
    expect(provider.rollback).toHaveBeenCalledTimes(1)
    expect(provider.commit).not.toHaveBeenCalled()
  })

  it('get() rolls back and rethrows when the read fails', async () => {
    const provider = new ExplodingProvider()
    const neode = new Neode(provider)

    await expect(neode.get(Leak, { name: 'x' })).rejects.toThrow('boom: the statement failed')
    expect(provider.rollback).toHaveBeenCalledTimes(1)
  })

  it('delete() rolls back and rethrows when the write fails', async () => {
    const provider = new ExplodingProvider()
    const neode = new Neode(provider)

    const entity = Object.assign(new Leak(), { id: 'u1', name: 'x' })

    await expect(neode.delete(entity)).rejects.toThrow('boom: the statement failed')
    expect(provider.rollback).toHaveBeenCalledTimes(1)
  })

  it('a failing rollback does not mask the original error', async () => {
    const provider = new ExplodingProvider()
    provider.rollback.mockRejectedValue(new Error('rollback also failed'))

    const neode = new Neode(provider)

    const error = await neode.get(Leak, {}).catch((caught: Error) => caught)

    // The original error keeps its identity and type; the rollback failure
    // is chained as its cause (and logged with the fix)
    expect((error as Error).message).toContain('boom: the statement failed')
    expect((error as Error).cause).toBeInstanceOf(Error)
    expect(((error as Error).cause as Error).message).toBe('rollback also failed')
  })

  it('validation errors still roll back (save() path)', async () => {
    // save() validates before the merge — a ValidationError must not leak
    // the open write transaction either
    const provider = new ExplodingProvider()

    // A model that passes the schema lookup but fails validation on write
    @NodeEntity()
    class Guarded {
      @Uuid({ primary: true })
      id: string

      @String({ min: 100 })
      name: string
    }

    const neode = new Neode(provider)

    await expect(
      neode.save(Object.assign(new Guarded(), { id: 'u1', name: 'too short' })),
    ).rejects.toThrow(ValidationError)

    expect(provider.rollback).toHaveBeenCalledTimes(1)
  })
})
