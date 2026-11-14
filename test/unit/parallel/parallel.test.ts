import { describe, expect, it } from 'vitest'
import { ParallelError } from '../../../src/transaction/parallel.js'
import { Neode } from '../../../src/neode.service.js'
import { Builder } from '../../../src/query/index.js'
import { FakeProvider } from './fakes.js'

describe('Neode#parallel — autocommit modes (NTS-631)', () => {
  it('resolves a named map of reads in one wall-clock batch, keyed by name', async () => {
    const provider = new FakeProvider()
    const neode = new Neode(provider)

    const results = await neode.parallel({
      tiles: async (scope) => {
        await scope.read('RETURN 1 AS tiles')

        return 'tiles-result'
      },
      throughput: async (scope) => {
        await scope.read('RETURN 2 AS throughput')

        return 'throughput-result'
      },
      users: async (scope) => {
        await scope.read('RETURN 3 AS users')

        return 'users-result'
      },
      roles: async (scope) => {
        await scope.read('RETURN 4 AS roles')

        return 'roles-result'
      },
    })

    expect(results).toEqual({
      tiles: 'tiles-result',
      throughput: 'throughput-result',
      users: 'users-result',
      roles: 'roles-result',
    })

    // One statement per operation, every one routed READ (the default mode)
    expect(provider.autocommit).toHaveLength(4)

    for (const [, mode] of provider.autocommit) {
      expect(mode).toBe('READ')
    }

    // All four sessions overlapped — sequential execution would peak at 1
    expect(provider.maxInFlight).toBe(4)
  })

  it('runs an array of operations and resolves results in input order', async () => {
    const neode = new Neode(new FakeProvider())

    const results = await neode.parallel([
      async (scope) => {
        await scope.read('RETURN 1')

        return 'first'
      },
      async (scope) => {
        await scope.read('RETURN 2')

        return 'second'
      },
    ])

    expect(results).toEqual(['first', 'second'])
  })

  it('builds and runs a Builder through the scope sugar', async () => {
    const provider = new FakeProvider()
    const neode = new Neode(provider)

    await neode.parallel({
      tiles: async (scope) => {
        await scope.read(new Builder().match('this', 'Tile').return('this'))

        return 'ok'
      },
    })

    expect(provider.autocommit[0]?.[0]).toContain('MATCH')
    expect(provider.autocommit[0]?.[1]).toBe('READ')
  })

  it("routes the scope's bare statements by the mode option", async () => {
    const provider = new FakeProvider()
    const neode = new Neode(provider)

    await neode.parallel(
      {
        a: (scope) => scope.run('RETURN 1'),
        b: (scope) => scope.run('RETURN 2'),
      },
      { mode: 'write' },
    )

    for (const [, mode] of provider.autocommit) {
      expect(mode).toBe('WRITE')
    }
  })

  it('surfaces autocommit write failures aligned per operation, after every operation ran', async () => {
    const boom = new Error('throughput write failed')
    const provider = new FakeProvider()
    const neode = new Neode(provider)

    const caught: unknown = await neode
      .parallel({
        tiles: async (scope) => {
          await scope.read('RETURN 1')

          return 'tiles-ok'
        },
        throughput: async (scope) => {
          await scope.write('CREATE (n:Throughput)')

          throw boom
        },
        roles: async (scope) => {
          await scope.read('RETURN 3')

          return 'roles-ok'
        },
      })
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(ParallelError)

    const error = caught as ParallelError

    expect(error.phase).toBe('body')
    expect(error.errors).toEqual([{ key: 'throughput', error: boom }])
    expect(error.cause).toBe(boom)
    expect(error.rollback).toBeUndefined()

    // Every operation ran — autocommit has no cross-operation atomicity
    expect(provider.autocommit).toHaveLength(3)
  })

  it('resolves an empty map without opening a session', async () => {
    const provider = new FakeProvider()
    const neode = new Neode(provider)

    const results = await neode.parallel({})

    expect(results).toEqual({})
    expect(provider.autocommit).toHaveLength(0)
    expect(provider.handles).toHaveLength(0)
  })
})
