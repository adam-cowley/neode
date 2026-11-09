import { describe, expect, it } from 'vitest'
import { DateTime, Filter, NodeEntity, OneToMany, String } from '../../src/decorators'
import type { QueryOutput, QueryRecord, Runner } from '../../src/driver/types'
import { NeodeError } from '../../src/errors'
import { getModel } from '../../src/meta'
import { assertFilterName } from '../../src/meta/entity/entity-schema'
import { Direction } from '../../src/query'
import { PaginateService } from '../../src/services/query/paginate.service'
import type { CursorPage } from '../../src/services/query/paginate.service'

/**
 * NTS-592 — pagination edge cases: the offset mode's elementId order
 * tiebreaker, the cursor mode's null-key handling, cursor/offset RETURN
 * parity for eager relationships, and the reserved filter names the
 * keyset statement binds.
 */

const captureRunner = (captured: string[]): Runner => ({
  run: (query: string) => {
    captured.push(query)

    return Promise.resolve({ records: [] } as unknown as QueryOutput)
  },
})

const staticRunner = (records: QueryRecord[]): Runner => ({
  run: () => Promise.resolve({ records } as unknown as QueryOutput),
})

const record = (value: unknown): QueryRecord => ({
  keys: ['this'],
  get: (key: string) => (key === 'this' ? value : undefined),
  has: (key: string) => key === 'this',
})

const node = (properties: Record<string, unknown>, elementId = '4:a'): unknown => ({
  elementId,
  properties,
})

@NodeEntity()
class Nts592Event {
  @String()
  name?: string

  @DateTime()
  createdAt?: string
}

@NodeEntity()
class Nts592Post {
  @String()
  title?: string
}

@NodeEntity()
class Nts592Author {
  @String()
  name?: string

  @DateTime()
  createdAt?: string

  @OneToMany(() => Nts592Post, 'WROTE', Direction.OUTGOING, true)
  posts?: Nts592Post[]
}

describe('paginate offset mode — elementId tiebreaker (NTS-592)', () => {
  const schema = getModel(Nts592Event)

  it('orders by elementId alone when no order is given', async () => {
    const captured: string[] = []

    await new PaginateService(captureRunner(captured)).paginate(
      Nts592Event,
      schema,
      {},
      { page: 2, limit: 5 },
    )

    expect(captured[0]).toBe(
      [
        'MATCH (this:Nts592Event)',
        'RETURN this',
        'ORDER BY elementId(this)',
        'SKIP 5',
        'LIMIT 5',
      ].join('\n'),
    )

    // the COUNT read stays untouched
    expect(captured[1]).not.toContain('ORDER BY')
  })

  it('appends the tiebreaker after the caller’s order', async () => {
    const captured: string[] = []

    await new PaginateService(captureRunner(captured)).paginate(
      Nts592Event,
      schema,
      {},
      {
        page: 1,
        limit: 5,
        order: 'name',
      },
    )

    expect(captured[0]).toBe(
      [
        'MATCH (this:Nts592Event)',
        'RETURN this',
        'ORDER BY this.name, elementId(this)',
        'LIMIT 5',
      ].join('\n'),
    )
  })

  it('appends the tiebreaker after a directed order', async () => {
    const captured: string[] = []

    await new PaginateService(captureRunner(captured)).paginate(
      Nts592Event,
      schema,
      {},
      {
        page: 1,
        limit: 5,
        order: { name: 'DESC' },
      },
    )

    expect(captured[0]).toContain('ORDER BY this.name DESC, elementId(this)')
  })
})

describe('paginate cursor mode — null keys (NTS-592)', () => {
  const schema = getModel(Nts592Event)

  it('excludes null-key rows on the first page', async () => {
    const captured: string[] = []

    await new PaginateService(captureRunner(captured)).paginate(
      Nts592Event,
      schema,
      {},
      { limit: 5 },
    )

    expect(captured[0]).toBe(
      [
        'MATCH (this:Nts592Event)',
        'WHERE this.createdAt IS NOT NULL',
        'ORDER BY this.createdAt ASC, elementId(this) ASC',
        'LIMIT 6',
        'RETURN this',
      ].join('\n'),
    )
  })

  it('keeps the null exclusion beside the cursor comparison', async () => {
    const captured: string[] = []

    await new PaginateService(captureRunner(captured)).paginate(
      Nts592Event,
      schema,
      {},
      {
        limit: 5,
        after: '2026-01-01T00:00:00Z',
      },
    )

    const query = captured[0] ?? ''

    expect(query).toContain('this.createdAt IS NOT NULL')
    expect(query).toContain('this.createdAt > datetime($cursor)')
    expect(query).not.toContain('datetime(null)')
  })

  it('ends the walk rather than emitting a cursor for a null boundary', async () => {
    const page = (await new PaginateService(
      staticRunner([record(node({})), record(node({}, '4:b')), record(node({}, '4:c'))]),
    ).paginate(Nts592Event, schema, {}, { limit: 2 })) as CursorPage<Nts592Event>

    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBeUndefined()
  })
})

describe('paginate cursor mode — RETURN parity with offset mode (NTS-592)', () => {
  const schema = getModel(Nts592Author)

  it('returns the eager projection in both modes', async () => {
    const offsetCaptured: string[] = []
    const cursorCaptured: string[] = []
    const service = new PaginateService(captureRunner(offsetCaptured))

    await service.paginate(Nts592Author, schema, {}, { page: 1, limit: 5 })

    const cursorService = new PaginateService(captureRunner(cursorCaptured))
    await cursorService.paginate(Nts592Author, schema, {}, { limit: 5 })

    const offset = offsetCaptured[0] ?? ''
    const cursor = cursorCaptured[0] ?? ''

    expect(offset).toContain('__EAGER_ID__: elementId(this)')
    expect(cursor).toContain('__EAGER_ID__: elementId(this)')
    expect(cursor).toContain('AS this')
    // the eager comprehension rides the RETURN, after LIMIT
    expect(cursor.indexOf('posts: [')).toBeGreaterThan(cursor.indexOf('LIMIT'))
  })

  it('still forms a cursor from an eager projection boundary', async () => {
    const projection = (createdAt: string, elementId: string): Record<string, unknown> => ({
      __EAGER_ID__: elementId,
      __EAGER_LABELS__: ['Nts592Author'],
      createdAt,
      posts: [],
    })

    const page = (await new PaginateService(
      staticRunner([
        record(projection('2026-01-01', '4:a')),
        record(projection('2026-01-02', '4:b')),
        record(projection('2026-01-03', '4:c')),
      ]),
    ).paginate(Nts592Author, schema, {}, { limit: 2 })) as CursorPage<Nts592Author>

    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBe(JSON.stringify(['2026-01-02', '4:b']))
  })
})

describe('reserved filter names (NTS-592)', () => {
  it('rejects the keyset statement’s own parameter names', () => {
    expect(() => assertFilterName('cursor')).toThrow(/reserved/)
    expect(() => assertFilterName('cursorId')).toThrow(/reserved/)
    expect(() => assertFilterName('filter_tenant')).toThrow(/reserved/)
    expect(() => assertFilterName('filter_')).toThrow(/reserved/)
  })

  it('still accepts names that merely contain the reserved words', () => {
    expect(() => assertFilterName('cursorish')).not.toThrow()
    expect(() => assertFilterName('prefilter_x')).not.toThrow()
  })

  it('rejects a reserved name at declaration time', () => {
    expect(() => {
      @NodeEntity()
      @Filter({ name: 'cursor', where: 'node.tenant = $cursor' })
      class Nts592Reserved {
        @String()
        id?: string
      }

      return Nts592Reserved
    }).toThrow(/reserved/)
  })
})
