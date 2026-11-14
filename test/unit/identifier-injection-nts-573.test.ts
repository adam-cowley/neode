import { describe, expect, it, vi } from 'vitest'
import { NodeEntity, Property, RelatedOne } from '../../src/decorators'
import type { QueryOutput, Runner } from '../../src/driver/types'
import { NeodeError } from '../../src/errors'
import { getModel } from '../../src/meta'
import { EntitySchema } from '../../src/meta/entity/entity-schema'
import { PropertyType } from '../../src/meta/property-schema'
import { ProjectionService } from '../../src/projection/projection.service'
import { relationProperty } from '../../src/projection/projection'
import { Builder } from '../../src/query'
import { parseLoadLevel } from '../../src/query/eager-utilities'
import { orderTerms } from '../../src/query/order-spec'
import {
  assertAlias,
  assertCount,
  assertDegrees,
  assertDirection,
  assertReference,
  propertyReference,
} from '../../src/query/quote'
import { MergeService } from '../../src/services/query/merge.service'
import { TraverseBuilder } from '../../src/traverse'

/**
 * Cypher identifier injection (NTS-573): raw caller-controlled strings
 * must never reach a statement as Cypher. Each site either throws a
 * NeodeError or emits a backtick-quoted identifier.
 */

const HOSTILE_KEY = 'name} DETACH DELETE x //'
const HOSTILE_DIRECTION = 'ASC; MATCH (x) DETACH DELETE x //'
const QUOTED_KEY = '`name} DETACH DELETE x //`'

@NodeEntity()
class InjectionCourse {
  @Property({ type: 'string' }) slug: string
}

@NodeEntity()
class InjectionPerson {
  @Property({ type: 'string' }) name: string

  @RelatedOne({ type: 'IN_COURSE', direction: 'out', fields: ['slug'] })
  course: { slug: string }
}

const captureRunner = (captured: string[]): Runner => ({
  run: (query: string) => {
    captured.push(query)

    return Promise.resolve({ records: [] } as unknown as QueryOutput)
  },
})

describe('shared validation helpers', () => {
  it('quotes hostile property keys and leaves plain ones readable', () => {
    expect(propertyReference('n', 'name')).toBe('n.name')
    expect(propertyReference('n', HOSTILE_KEY)).toBe(`n.${QUOTED_KEY}`)
    expect(propertyReference('n', 'a`b')).toBe('n.`a``b`')
  })

  it('accepts ASC / DESC in any case and rejects anything else', () => {
    expect(assertDirection('desc')).toBe('DESC')
    expect(assertDirection('')).toBe('')
    expect(() => assertDirection(HOSTILE_DIRECTION)).toThrow(NeodeError)
  })

  it('rejects non-identifier aliases and references, with a fix', () => {
    expect(assertAlias('t1', 'x')).toBe('t1')
    expect(assertReference('t1.name', 'x')).toBe('t1.name')
    expect(() => assertAlias('t1) DETACH DELETE t1 //', 'x')).toThrow(/plain identifiers/)
    expect(() => assertReference('t1.name //', 'x')).toThrow(NeodeError)
  })

  it('validates degrees and counts', () => {
    for (const ok of ['2', '1..3', '..3', '1..', '..']) {
      expect(assertDegrees(ok)).toBe(ok)
    }
    expect(() => assertDegrees('1]-() DETACH DELETE n //')).toThrow(NeodeError)
    expect(() => assertCount(-1, 'limit')).toThrow(/non-negative integer/)
    expect(() => assertCount(1.5, 'skip')).toThrow(NeodeError)
    expect(() => assertCount(Number.NaN, 'limit')).toThrow(NeodeError)
    expect(() => assertCount(Number.MAX_SAFE_INTEGER + 2, 'limit')).toThrow(NeodeError)
    expect(assertCount(0, 'limit')).toBe(0)
  })
})

describe('orderTerms (order-spec, paginate offset order, load-spec order)', () => {
  it('quotes a hostile field in every spec form', () => {
    expect(orderTerms(HOSTILE_KEY, 'n')).toEqual([`n.${QUOTED_KEY}`])
    expect(orderTerms({ field: HOSTILE_KEY, order: 'DESC' }, 'n')).toEqual([`n.${QUOTED_KEY} DESC`])
    expect(orderTerms({ [HOSTILE_KEY]: 'asc' }, 'n')).toEqual([`n.${QUOTED_KEY} ASC`])
    expect(orderTerms([{ name: 'DESC' }, 'age'], 'n')).toEqual(['n.name DESC', 'n.age'])
  })

  it('rejects a hostile direction in every spec form', () => {
    expect(() => orderTerms({ name: HOSTILE_DIRECTION }, 'n')).toThrow(NeodeError)
    expect(() => orderTerms({ field: 'name', order: HOSTILE_DIRECTION }, 'n')).toThrow(NeodeError)
    expect(() => orderTerms([{ name: HOSTILE_DIRECTION }], 'n')).toThrow(/ASC.*DESC/)
  })

  it('rejects a hostile load-spec order when the spec is parsed', () => {
    const schema = getModel(InjectionPerson) as EntitySchema

    expect(() => parseLoadLevel(schema, { order: { name: HOSTILE_DIRECTION } })).toThrow(NeodeError)
    expect(parseLoadLevel(schema, { order: { name: 'desc' } }).order).toEqual({ name: 'desc' })
  })
})

describe('Builder', () => {
  it('rejects a hostile orderBy direction', () => {
    expect(() => new Builder().match('n', 'N').orderBy('n.name', HOSTILE_DIRECTION)).toThrow(
      NeodeError,
    )
    expect(() => new Builder().match('n', 'N').orderBy({ 'n.name': HOSTILE_DIRECTION })).toThrow(
      NeodeError,
    )
    expect(() =>
      new Builder().match('n', 'N').orderBy({ field: 'n.name', order: HOSTILE_DIRECTION }),
    ).toThrow(NeodeError)
  })

  it('rejects unsafe limit / skip values, including WITH-attached ones', () => {
    const builder = (): Builder => new Builder().match('n', 'N').with('n')

    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new Builder().match('n', 'N').limit(bad)).toThrow(NeodeError)
      expect(() => new Builder().match('n', 'N').skip(bad)).toThrow(NeodeError)
      expect(() => builder().withLimit(bad)).toThrow(NeodeError)
      expect(() => builder().withSkip(bad)).toThrow(NeodeError)
    }

    expect(() =>
      new Builder().match('n', 'N').limit('1; MATCH (x) DETACH DELETE x' as never),
    ).toThrow(NeodeError)
  })

  it('rejects hostile relationship degrees and quotes relationship types', () => {
    expect(() =>
      new Builder()
        .match('a', 'A')
        .relationship('R', 'out', 'r', '1]-() DETACH DELETE a //')
        .to('b', 'B')
        .build(),
    ).toThrow(NeodeError)

    const { query } = new Builder()
      .match('a', 'A')
      .relationship(['R', 'S`]->() DETACH DELETE a //'], 'out', 'r', '1..2')
      .to('b', 'B')
      .return('b')
      .build()

    expect(query).toContain('[r:`R`|`S``]->() DETACH DELETE a //`*1..2]')
  })
})

describe('relationProperty (relation orderBy / where sub-builder)', () => {
  it('prefixes bare names, passes dotted references, quotes anything else', () => {
    expect(relationProperty('t', 'slug')).toBe('t.slug')
    expect(relationProperty('t', 'other.slug')).toBe('other.slug')
    expect(relationProperty('t', HOSTILE_KEY)).toBe(`t.${QUOTED_KEY}`)
    expect(relationProperty('t', 'x.y} DETACH DELETE x //')).toBe('t.`x.y} DETACH DELETE x //`')
  })
})

describe('MergeService.mergeOn undeclared set keys (repository.upsert)', () => {
  it('quotes a hostile undeclared key instead of emitting it raw', async () => {
    const schema = new EntitySchema()

    schema.setLabels(['Thing'])
    schema.addProperty('email')
    schema.getProperty('email').setType(PropertyType.STRING)
    schema.getProperty('email').setUnique(true)

    const run = vi.fn(() => Promise.resolve({ records: [] }))

    await new MergeService({ run } as unknown as Runner).mergeOn(
      schema,
      { email: 'a@b.c' },
      { [HOSTILE_KEY]: 1, plain: 2 },
    )

    const [statement] = run.mock.calls[0] as unknown as [string]

    expect(statement).toContain(`this.${QUOTED_KEY} =`)
    expect(statement).not.toContain('this.name}')
  })
})

describe('ProjectionService nested filters and sorts', () => {
  const compile = async (params: Record<string, unknown>, order?: unknown): Promise<string> => {
    const captured: string[] = []

    await new ProjectionService(captureRunner(captured)).get(
      InjectionPerson,
      getModel(InjectionPerson) as EntitySchema,
      params,
      undefined,
      undefined,
      order as never,
    )

    return captured[0] ?? ''
  }

  it('quotes a hostile nested filter field', async () => {
    const query = await compile({ course: { [HOSTILE_KEY]: 'x' } })

    expect(query).toContain(QUOTED_KEY)
    expect(query).not.toMatch(/\.name\} DETACH/)
  })

  it('quotes a hostile nested sort field (collected sort)', async () => {
    const query = await compile({}, { course: HOSTILE_KEY })

    expect(query).toContain(QUOTED_KEY)
    expect(query).not.toMatch(/\.name\} DETACH/)
  })

  it('quotes hostile top-level sort fields and rejects hostile directions', async () => {
    expect(await compile({}, HOSTILE_KEY)).toContain(`this.${QUOTED_KEY}`)
    expect(await compile({}, { field: HOSTILE_KEY, order: 'desc' })).toContain(
      `this.${QUOTED_KEY} DESC`,
    )
    await expect(compile({}, { name: HOSTILE_DIRECTION })).rejects.toThrow(NeodeError)
    await expect(compile({}, { course: 'slug', name: HOSTILE_DIRECTION })).rejects.toThrow(
      NeodeError,
    )
  })

  it('rejects an unsafe limit / skip', async () => {
    await expect(
      new ProjectionService(captureRunner([])).get(
        InjectionPerson,
        getModel(InjectionPerson) as EntitySchema,
        {},
        -1,
      ),
    ).rejects.toThrow(NeodeError)
  })
})

describe('TraverseBuilder', () => {
  const traverse = (): TraverseBuilder =>
    new TraverseBuilder(
      { run: () => Promise.resolve({ records: [] } as unknown as QueryOutput) },
      () => InjectionPerson,
    )

  it('rejects hostile degrees, orderBy fields / directions, aliases and exclusions', () => {
    expect(() =>
      traverse().hop('R', 'out', InjectionCourse, '1..2]-() DETACH DELETE x //'),
    ).toThrow(NeodeError)
    expect(() => traverse().orderBy('times; MATCH (x) DETACH DELETE x //')).toThrow(NeodeError)
    expect(() => traverse().orderBy('times', HOSTILE_DIRECTION as 'ASC')).toThrow(NeodeError)
    expect(() => traverse().countDistinct('t1) DETACH DELETE t1 //', 'times')).toThrow(NeodeError)
    expect(() => traverse().countDistinct('t1', 'x` DETACH DELETE t1 //')).toThrow(NeodeError)
    expect(() => traverse().exclude('t0) DETACH DELETE t0 //', 'R', 't1')).toThrow(NeodeError)
    expect(() => traverse().exclude('t0', 'R', 't1) //')).toThrow(NeodeError)
    expect(() => traverse().limit(-1)).toThrow(NeodeError)
    expect(() => traverse().limit(1.5)).toThrow(NeodeError)
  })

  it('accepts the documented forms', async () => {
    await expect(
      traverse()
        .hop('R', 'out', InjectionCourse, '1..2')
        .exclude('t0', 'R', 't1')
        .countDistinct('t1', 'times')
        .groupBy('t1')
        .orderBy('times', 'DESC')
        .limit(5)
        .runAggregates(),
    ).resolves.toEqual([])
  })
})

describe('NTS-675 — 1.0 security review hardening', () => {
  it('safeKey is idempotent: a fully quoted segment passes through, a hostile one with backticks is quoted', () => {
    expect(propertyReference('n', QUOTED_KEY)).toBe(`n.${QUOTED_KEY}`)
    expect(propertyReference('n', 'x`: 1 //')).toBe('n.`x``: 1 //`')
  })

  it('escapes a hostile where() property key (equality and operator forms)', () => {
    for (const built of [
      new Builder().match('n', 'N').where(HOSTILE_KEY, 1).build(),
      new Builder().match('n', 'N').where(HOSTILE_KEY, '>', 1).build(),
      new Builder()
        .match('n', 'N')
        .where({ [HOSTILE_KEY]: 1 })
        .build(),
      new Builder().match('n', 'N').whereNull(HOSTILE_KEY).build(),
      new Builder().match('n', 'N').whereNotNull(HOSTILE_KEY).build(),
      new Builder().match('n', 'N').whereIn(HOSTILE_KEY, [1]).build(),
      new Builder().match('n', 'N').whereContains(HOSTILE_KEY, 'x').build(),
    ]) {
      expect(built.query).toContain(QUOTED_KEY)
      expect(built.query).not.toContain('name} DETACH DELETE x // =')
    }
  })

  it('rejects a hostile where() operator (whereRaw is the escape hatch)', () => {
    const hostile = '> 0 AND n.name =~ "x" //'

    expect(() => new Builder().match('n', 'N').where('n.age', hostile, 1)).toThrow(NeodeError)

    // every documented operator still accepted, any case
    for (const operator of ['=', '<>', '<', '<=', '>', '>=', 'in', 'contains', '=~']) {
      expect(() => new Builder().match('n', 'N').where('n.age', operator, 1)).not.toThrow()
    }
  })

  it('escapes a hostile whereBetween reference and rejects hostile whereId / asPath / pattern aliases', () => {
    expect(new Builder().match('n', 'N').whereBetween(HOSTILE_KEY, 1, 2).build().query).toContain(
      QUOTED_KEY,
    )

    for (const build of [
      () => new Builder().match('n', 'N').whereId(HOSTILE_KEY, 'x'),
      () => new Builder().match('n', 'N').asPath(HOSTILE_KEY),
      () => new Builder().match(HOSTILE_KEY, 'N'),
      () => new Builder().optionalMatch(HOSTILE_KEY, 'N'),
      () => new Builder().create(HOSTILE_KEY, 'N'),
      () => new Builder().merge(HOSTILE_KEY, 'N'),
      () => new Builder().match('a').relationship('R', 'out', HOSTILE_KEY),
      () => new Builder().match('a').to(HOSTILE_KEY, 'B'),
    ]) {
      expect(build).toThrow(NeodeError)
    }
  })

  it('rejects a hostile set() operator and quotes a hostile SET key carrying backticks', () => {
    expect(() =>
      new Builder().match('n', 'N').set('n.name', 'x', '= 1 DETACH DELETE n //'),
    ).toThrow(NeodeError)

    for (const build of [
      () => new Builder().match('n', 'N').set('n.age', 30, '+='),
      () => new Builder().match('n', 'N').onCreateSet('n.age', 30, '-='),
      () => new Builder().match('n', 'N').onMatchSet('n.age', 30, '='),
    ]) {
      expect(build).not.toThrow()
    }

    // the SET path (Property.toString) quotes a backtick-bearing key —
    // previously it passed through verbatim
    const { query } = new Builder().match('n', 'N').set('n.x`: 1 //', 5).build()

    expect(query).toContain('n.`x``: 1 //` = $set_0')
    expect(query).not.toContain('x`: 1 // =')
  })
})
