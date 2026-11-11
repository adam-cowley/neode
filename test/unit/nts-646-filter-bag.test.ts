import { NodeEntity, OneToMany, Property } from '../../src/decorators'
import { defineModel } from '../../src/meta/map-schema'
import { Direction } from '../../src/query'
import { QueryOutput, Runner } from '../../src/driver/types'
import { getModel } from '../../src/meta'
import { Builder } from '../../src/query'
import { NeodeError } from '../../src/errors'
import { applyFilterBag, isFilterMap } from '../../src/services/query/filter-bag'
import { GetService } from '../../src/services/query/get.service'
import { PaginateService } from '../../src/services/query/paginate.service'

/**
 * The shared where-filter consumption path (NTS-646): property equality
 * byte-identical to the per-service loops it replaced, the operator-object
 * tier rendered through the Builder's operator methods, unknown operator
 * keys failing loud, and non-plain-object values (Date / temporals /
 * Point) staying equality values.
 */

interface CapturedQuery {
  query: string
  params: Record<string, unknown>
}

/** Runner stub that records every compiled query without touching a database */
function captureRunner(captured: CapturedQuery[]): Runner {
  return {
    run: async (query: string, params?: Record<string, unknown>) => {
      captured.push({ query, params: params ?? {} })

      return { records: [] } as unknown as QueryOutput
    },
  }
}

async function compileGet(parameters: Record<string, unknown>): Promise<CapturedQuery> {
  const captured: CapturedQuery[] = []

  await new GetService(captureRunner(captured)).get(
    NTS646FilterPerson,
    getModel(NTS646FilterPerson),
    parameters,
  )

  expect(captured).toHaveLength(1)

  return captured[0]
}

@NodeEntity()
class NTS646FilterPet {
  @Property({ type: 'string' })
  kind!: string
}

@NodeEntity()
class NTS646FilterPerson {
  @Property({ type: 'string' })
  name!: string

  @Property({ type: 'number' })
  age!: number

  @Property({ type: 'string' })
  nickname!: string

  @Property({ type: 'string' })
  tags!: string

  @Property({ type: 'date' })
  createdAt?: Date

  @OneToMany(() => NTS646FilterPet, 'HAS_PET', Direction.OUTGOING)
  pets?: NTS646FilterPet[]
}

describe('the shared filter-bag helper (NTS-646)', () => {
  it('equality renders byte-identical to the loops it replaced', async () => {
    const { query, params } = await compileGet({ name: 'Adam', age: 18 })

    // byte-identical: the clauses join inside one parenthesised group,
    // exactly as the per-service loops rendered them
    expect(query).toContain('WHERE (this.name = $where_this_name AND this.age = $where_this_age)')
    expect(params['where_this_name']).toBe('Adam')
    expect(params['where_this_age']).toBe(18)
  })

  it('renders every operator of the set through its Builder method', async () => {
    const { query, params } = await compileGet({
      name: { eq: 'Adam', neq: 'Bob', contains: 'da', startsWith: 'Ad', endsWith: 'am' },
      age: { gt: 3, gte: 3, lt: 9, lte: 9 },
      tags: { in: ['a', 'b'] },
    })

    // eq/neq/gt/gte/lt/lte — comparison + negation forms
    expect(query).toContain('this.name = $where_this_name')
    expect(query).toContain('NOT this.name = $where_this_name')
    expect(query).toContain('this.age > $where_this_age')
    expect(query).toContain('this.age >= $where_this_age')
    expect(query).toContain('this.age < $where_this_age')
    expect(query).toContain('this.age <= $where_this_age')
    // contains/startsWith/endsWith
    expect(query).toContain('this.name CONTAINS $where_this_name')
    expect(query).toContain('this.name STARTS WITH $where_this_name')
    expect(query).toContain('this.name ENDS WITH $where_this_name')
    // in
    expect(query).toContain('this.tags IN $where_this_tags')
    expect(params['where_this_tags']).toEqual(['a', 'b'])
  })

  it('null: true / null: false render IS NULL / IS NOT NULL', async () => {
    const gone = await compileGet({ nickname: { null: true } })

    expect(gone.query).toContain('this.nickname IS NULL')

    const here = await compileGet({ nickname: { null: false } })

    expect(here.query).toContain('this.nickname IS NOT NULL')
  })

  it('a Date value stays an equality value (the plain-object rule)', async () => {
    const stamp = new Date('2026-01-01T00:00:00Z')
    const { query, params } = await compileGet({ createdAt: stamp })

    expect(query).toContain('(this.createdAt = $where_this_createdAt)')
    expect(params['where_this_createdAt']).toBe(stamp)
  })

  it('escapes non-identifier property keys in the equality tier (map-API keys are arbitrary strings)', () => {
    const hostile = 'weird} DETACH DELETE x //'

    const Quoted = defineModel('NTS646FilterQuotedKey', {
      [hostile]: { type: 'string' },
    })

    const builder = new Builder().match('this', ['NTS646FilterQuotedKey'])

    applyFilterBag(builder, getModel(Quoted), { [hostile]: 'x' })

    const { query } = builder.build()

    // the key is a backticked identifier, not raw statement text
    expect(query).toContain('this.`weird} DETACH DELETE x //` = $')
  })

  it('a class instance (driver Point shape) stays an equality value', () => {
    class PointStub {
      srid = 7203
      x = 1
      y = 2
    }

    expect(isFilterMap(new PointStub())).toBe(false)
    expect(isFilterMap(new Date())).toBe(false)
    expect(isFilterMap([1, 2])).toBe(false)
    expect(isFilterMap({ gte: 3 })).toBe(true)
    expect(isFilterMap(Object.create(null))).toBe(true)
  })

  it('an unknown operator key throws a descriptive NeodeError', () => {
    const builder = new Builder()

    expect(() =>
      applyFilterBag(builder, getModel(NTS646FilterPerson), {
        age: { greatherThan: 3 },
      }),
    ).toThrow(NeodeError)

    expect(() =>
      applyFilterBag(builder, getModel(NTS646FilterPerson), {
        age: { greatherThan: 3 },
      }),
    ).toThrow(/Unknown where-filter operator "greatherThan" on property "age"/)
  })

  it('a non-string value on a string operator fails loud', () => {
    const builder = new Builder()

    expect(() =>
      applyFilterBag(builder, getModel(NTS646FilterPerson), {
        // the typed tier rejects this; the runtime tier fails loud too
        name: { contains: 3 as unknown as string },
      }),
    ).toThrow(/"contains" filter on property "name" expects a string/)

    expect(() =>
      applyFilterBag(builder, getModel(NTS646FilterPerson), {
        tags: { in: 'abc' as unknown as string[] },
      }),
    ).toThrow(/"in" filter on property "tags" expects an array/)
  })

  it('an unknown bag key throws (fail loud — a silently-ignored filter narrows nothing)', async () => {
    await expect(compileGet({ nope: 'x' })).rejects.toThrow(
      /Unknown where-filter key "nope" on NTS646FilterPerson/,
    )

    // the deleteAll hazard: a bag whose keys all miss the schema must
    // never reach a statement
    await expect(compileGet({ nope: 'x', alsoNope: 'y' })).rejects.toThrow(NeodeError)
  })

  it('a nested relationship bag on the plain path throws (it only runs on the projection path)', async () => {
    await expect(compileGet({ pets: { kind: 'Dog' } })).rejects.toThrow(
      /The where-filter key "pets" is a relationship of NTS646FilterPerson/,
    )
    await expect(compileGet({ pets: { kind: 'Dog' } })).rejects.toThrow(/projection path/)
  })

  it('an empty operator object throws (rendering it would filter nothing)', () => {
    const builder = new Builder()

    expect(() => applyFilterBag(builder, getModel(NTS646FilterPerson), { age: {} })).toThrow(
      /empty operator object/,
    )

    expect(() => applyFilterBag(builder, getModel(NTS646FilterPerson), { age: {} })).toThrow(
      /pass the bare value for equality/,
    )
  })

  it('an explicit eq takes any value — the wrapper escape for object-valued properties', async () => {
    const value = { raw: 'json' }
    const { query, params } = await compileGet({ tags: { eq: value } })

    expect(query).toContain('this.tags = $where_this_tags')
    expect(params['where_this_tags']).toBe(value)
  })

  it('keyset pagination renders the operator tier through the shared renderer', async () => {
    const captured: CapturedQuery[] = []
    const paginate = new PaginateService(captureRunner(captured))

    const page = await paginate.paginate(
      NTS646FilterPerson,
      getModel(NTS646FilterPerson),
      {
        name: 'Adam',
        age: { gte: 3 },
        nickname: { neq: 'X', startsWith: 'A', null: false },
        createdAt: { null: true },
        tags: { in: ['a', 'b'], contains: 't' },
      },
      { limit: 10, orderBy: 'age', after: '2026-01-01T00:00:00Z' },
    )

    expect(page.items).toEqual([])

    const statement = captured[0]

    // the operator conditions join the hand-written WHERE beside the bare
    // equality, the key exclusion and the cursor comparison
    expect(statement?.query).toContain('this.name = $filter_name')
    expect(statement?.query).toContain('this.age >= $filter_age_gte')
    expect(statement?.query).toContain('NOT this.nickname = $filter_nickname_neq')
    expect(statement?.query).toContain('this.nickname STARTS WITH $filter_nickname_startsWith')
    expect(statement?.query).toContain('this.nickname IS NOT NULL')
    expect(statement?.query).toContain('this.createdAt IS NULL')
    expect(statement?.query).toContain('this.tags IN $filter_tags_in')
    expect(statement?.query).toContain('this.tags CONTAINS $filter_tags_contains')
    expect(statement?.params['filter_name']).toBe('Adam')
    expect(statement?.params['filter_age_gte']).toBe(3)
    expect(statement?.params['filter_nickname_neq']).toBe('X')
    expect(statement?.params['filter_tags_in']).toEqual(['a', 'b'])
    expect(statement?.params['filter_tags_contains']).toBe('t')
  })

  it('the keyset path fails loud on unknown bag keys and nested relationship bags', async () => {
    const paginate = new PaginateService(captureRunner([]))

    await expect(
      paginate.paginate(
        NTS646FilterPerson,
        getModel(NTS646FilterPerson),
        { nope: 'x' },
        { limit: 10, orderBy: 'age', after: '2026-01-01T00:00:00Z' },
      ),
    ).rejects.toThrow(/Unknown where-filter key "nope"/)

    await expect(
      paginate.paginate(
        NTS646FilterPerson,
        getModel(NTS646FilterPerson),
        { pets: { kind: 'Dog' } },
        { limit: 10, orderBy: 'age', after: '2026-01-01T00:00:00Z' },
      ),
    ).rejects.toThrow(/is a relationship of NTS646FilterPerson/)
  })
})
