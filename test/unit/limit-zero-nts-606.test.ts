/**
NTS-606: `limit: 0` is rejected on every hydrated read path — it used to
mean "no limit" (the most dangerous direction a limit can fail in), while
paginate's requireLimit already rejected it. limit 1 / undefined unchanged.
*/
import { describe, expect, it } from 'vitest'
import { NodeEntity, Property, Primary } from '../../src/decorators'
import type { QueryOutput, Runner } from '../../src/driver/types'
import { getModel } from '../../src/meta'
import { Builder } from '../../src/query/index'
import { ProjectionService } from '../../src/projection/projection.service'
import { QueryService } from '../../src/services/query/query.service'
import { Repository } from '../../src/repository'
import type { INeode } from '../../src/neode.interface'
import { vi } from 'vitest'

interface Captured {
  query: string
  params: Record<string, unknown>
}

function captureRunner(captured: Captured[]): Runner {
  return {
    run: async (query: string, params?: Record<string, unknown>) => {
      captured.push({ query, params: params ?? {} })

      return { records: [] } as unknown as QueryOutput
    },
  }
}

@NodeEntity()
class N606Item {
  @Primary()
  @Property({ type: 'string' })
  id: string

  @Property({ type: 'string' })
  name: string
}

describe('limit: 0 is rejected on hydrated reads (NTS-606)', () => {
  it('QueryService.return throws on limit 0, keeps limit 1 and undefined', async () => {
    const schema = getModel(N606Item)

    await expect(
      new QueryService(captureRunner([])).return(N606Item, schema, new Builder(), undefined, 0),
    ).rejects.toThrow(/limit/i)

    const one: Captured[] = []
    await new QueryService(captureRunner(one)).return(N606Item, schema, new Builder(), undefined, 1)
    expect(one[0]?.query).toContain('LIMIT 1')

    const none: Captured[] = []
    await new QueryService(captureRunner(none)).return(
      N606Item,
      schema,
      new Builder(),
      undefined,
      undefined,
    )
    expect(none[0]?.query).not.toContain('LIMIT')
  })

  it('ProjectionService.get throws on limit 0, keeps limit 1', async () => {
    const schema = getModel(N606Item)

    await expect(
      new ProjectionService(captureRunner([])).get(N606Item, schema, {}, 0),
    ).rejects.toThrow(/limit/i)

    const one: Captured[] = []
    await new ProjectionService(captureRunner(one)).get(N606Item, schema, {}, 1)
    expect(one[0]?.query).toContain('LIMIT 1')
  })

  it('Repository.findAll throws on limit 0, keeps limit 1', async () => {
    const readCypher = vi
      .fn<(query: string, params: Record<string, unknown>) => Promise<QueryOutput>>()
      .mockResolvedValue({ records: [] } as unknown as QueryOutput)
    const neode = { readCypher } as unknown as INeode

    const repo = new Repository<N606Item>(neode, N606Item)

    await expect(repo.findAll({}, { limit: 0 })).rejects.toThrow(/limit/i)

    await repo.findAll({}, { limit: 1 })
    expect(readCypher.mock.calls[0]?.[0]).toContain('LIMIT 1')
  })
})
