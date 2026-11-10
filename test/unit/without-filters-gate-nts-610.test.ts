/**
NTS-610: `withoutFilters: ['*']` is the write paths' internal re-hydration
escape — every public read option bag (facade, TransactionalService,
Repository, load specs, traverse) rejects it with a NeodeError, while
named filters keep working and the internal service call sites are
untouched (they pass '*' straight to the query services).
*/
import { describe, expect, it, vi } from 'vitest'
import { Filter, NodeEntity, OneToMany, Primary, Property, SoftDelete } from '../../src/decorators'
import type { ConnectionProvider, QueryOutput } from '../../src/driver/types'
import { NeodeError } from '../../src/errors/index'
import { parseLoadLevel } from '../../src/query/eager-utilities'
import { getModel } from '../../src/meta'
import { Neode } from '../../src/neode.service'
import type { INeode } from '../../src/neode.interface'
import { Repository } from '../../src/repository'
import { assertPublicWithoutFilters, WITHOUT_ALL_FILTERS } from '../../src/services/query/filters'

// ---- Fixtures ----------------------------------------------------------------

@NodeEntity()
@SoftDelete()
@Filter({ name: 'tenant', where: 'node.tenant = $tenant' })
class N610Item {
  @Primary()
  @Property({ type: 'string' })
  id: string

  @Property({ type: 'string' })
  tenant: string

  @OneToMany(() => N610Tag, 'TAGGED')
  tags: N610Tag[]
}

@NodeEntity()
class N610Tag {
  @Primary()
  @Property({ type: 'string' })
  id: string
}

// A runner is never reached — the gate fires before any statement runs
const stubProvider = {} as unknown as ConnectionProvider

const neode = new Neode(stubProvider)

const GATE_ERROR = /withoutFilters: \['\*'\]/

// ---- The gate itself ---------------------------------------------------------

describe('assertPublicWithoutFilters (NTS-610)', () => {
  it("throws a NeodeError on '*' (WITHOUT_ALL_FILTERS)", () => {
    expect(() => assertPublicWithoutFilters(['*'])).toThrow(NeodeError)
    expect(() => assertPublicWithoutFilters([WITHOUT_ALL_FILTERS])).toThrow(GATE_ERROR)
    expect(() => assertPublicWithoutFilters(['tenant', '*'])).toThrow(NeodeError)
  })

  it('passes named filters, the reserved softDelete name and undefined through', () => {
    expect(() => assertPublicWithoutFilters(undefined)).not.toThrow()
    expect(() => assertPublicWithoutFilters(['tenant'])).not.toThrow()
    expect(() => assertPublicWithoutFilters(['softDelete', 'tenant'])).not.toThrow()
  })
})

// ---- The facade option bags ----------------------------------------------------

describe('facade reads reject withoutFilters ["*"] (NTS-610)', () => {
  it('all rejects (the options slot)', async () => {
    await expect(
      neode.all(N610Item, {}, undefined, undefined, undefined, undefined, {
        withoutFilters: ['*'],
      }),
    ).rejects.toThrow(GATE_ERROR)
  })

  it('find rejects (the options slot)', async () => {
    await expect(neode.find(N610Item, 'i1', { withoutFilters: ['*'] })).rejects.toThrow(GATE_ERROR)
  })

  it('get rejects (the database-or-options slot)', async () => {
    await expect(
      neode.get(N610Item, {}, undefined, undefined, { withoutFilters: ['*'] }),
    ).rejects.toThrow(GATE_ERROR)
  })

  it('paginate, findManyAndCount and chunk reject (the options slot)', async () => {
    await expect(
      neode.paginate(N610Item, {}, { page: 1, limit: 5, withoutFilters: ['*'] }),
    ).rejects.toThrow(GATE_ERROR)
    await expect(neode.findManyAndCount(N610Item, {}, { withoutFilters: ['*'] })).rejects.toThrow(
      GATE_ERROR,
    )
    await expect(
      neode.chunk(N610Item, {}, 10, () => undefined, { withoutFilters: ['*'] }),
    ).rejects.toThrow(GATE_ERROR)
  })

  it('search, knn and withinDistance reject (the filters param)', async () => {
    const filters = { withoutFilters: ['*'] }

    await expect(neode.search(N610Item, 'idx', 'query', undefined, filters)).rejects.toThrow(
      GATE_ERROR,
    )
    await expect(neode.knn(N610Item, 'idx', [1], 5, undefined, filters)).rejects.toThrow(GATE_ERROR)
    await expect(
      neode.withinDistance(
        N610Item,
        'location',
        { x: 0, y: 0 },
        10,
        {},
        undefined,
        undefined,
        undefined,
        undefined,
        filters,
      ),
    ).rejects.toThrow(GATE_ERROR)
  })

  it('relatedQuery rejects; named filters still construct the scope', () => {
    expect(() =>
      neode.relatedQuery(N610Item, { id: 'i1' }, 'tags', { withoutFilters: ['*'] }),
    ).toThrow(GATE_ERROR)

    expect(() =>
      neode.relatedQuery(N610Item, { id: 'i1' }, 'tags', { withoutFilters: ['tenant'] }),
    ).not.toThrow()
  })

  it('lazy rejects on first pull', async () => {
    const walk = neode.lazy(N610Item, {}, { withoutFilters: ['*'] })

    await expect(walk.next()).rejects.toThrow(GATE_ERROR)
  })
})

// ---- Load specs and the traverse builder ---------------------------------------

describe('load specs and traverse reject withoutFilters ["*"] (NTS-610)', () => {
  it('a load spec level rejects *; named filters still parse', () => {
    const schema = getModel(N610Item)

    expect(() => parseLoadLevel(schema, { withoutFilters: ['*'] })).toThrow(GATE_ERROR)
    expect(() => parseLoadLevel(schema, { withoutFilters: ['tenant'] })).not.toThrow()
  })

  it('TraverseBuilder.withoutFilters rejects *; named filters still record', () => {
    expect(() => neode.traverse(N610Item).withoutFilters('*')).toThrow(GATE_ERROR)
    expect(() => neode.traverse(N610Item, { withoutFilters: ['*'] })).toThrow(GATE_ERROR)

    expect(() => neode.traverse(N610Item).withoutFilters('tenant', 'softDelete')).not.toThrow()
  })
})

// ---- The Repository -------------------------------------------------------------

describe('Repository reads reject withoutFilters ["*"] (NTS-610)', () => {
  function stubNeode(): { neode: INeode; readCypher: INeode['readCypher'] } {
    const readCypher = vi
      .fn<(query: string, params: Record<string, unknown>) => Promise<QueryOutput>>()
      .mockResolvedValue({ records: [] } as unknown as QueryOutput)

    return { neode: { readCypher } as unknown as INeode, readCypher }
  }

  it('findAll rejects', async () => {
    const { neode: stubbed } = stubNeode()

    const repo = new Repository<N610Item>(stubbed, N610Item)

    await expect(repo.findAll({}, { withoutFilters: ['*'] })).rejects.toThrow(GATE_ERROR)
  })

  it('find forwards the option bag to the gated facade mapper', async () => {
    const find = vi
      .fn<(constructor: unknown, value: unknown, options?: unknown) => Promise<unknown>>()
      .mockResolvedValue(undefined)

    const repo = new Repository<N610Item>({ find } as unknown as INeode, N610Item)

    await repo.find('i1', { withoutFilters: ['*'] })

    // The rejection itself is the facade gate's (covered above); the
    // repository must not strip the option bag on the way there
    expect(find).toHaveBeenCalledWith(N610Item, 'i1', { withoutFilters: ['*'] })
  })

  it('named filters still read; the filter clause stays in the statement', async () => {
    const { neode: stubbed, readCypher } = stubNeode()

    const repo = new Repository<N610Item>(stubbed, N610Item)

    await expect(repo.findAll({}, { withoutFilters: ['tenant'] })).resolves.toEqual([])
    expect(readCypher).toHaveBeenCalledTimes(1)

    // The tenant filter is disabled by name — the soft-delete label check
    // stays in the statement
    expect(readCypher.mock.calls[0]?.[0]).toContain('NOT')
  })
})
