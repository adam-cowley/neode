import { describe, expect, it, vi } from 'vitest'
import { MergeService } from '../../src/services/query/merge.service'
import { UpdateService } from '../../src/services/query/update.service'
import { BulkService } from '../../src/services/query/bulk.service'
import { MAX_SAVE_DEPTH } from '../../src/services/write-utilities'
import { defineModel } from '../../src/meta/map-schema'
import { getModel } from '../../src/meta'
import { EntitySchema } from '../../src/meta/entity/entity-schema'
import { PropertyType } from '../../src/meta/property-schema'
import { NodeEntity, OneToOne, Property, Protected } from '../../src/decorators'
import { Direction } from '../../src/query'
import { Repository } from '../../src/repository'
import { NeodeError } from '../../src/errors'
import { toJson } from '../../src/serialise'
import type { INeode } from '../../src/neode.interface'
import type { GraphNode, QueryOutput, QueryRecord, Runner } from '../../src/driver/types'

/**
 * Write-path correctness (NTS-597): nested-create pipeline ordering, DB-state
 * derive on update, increment recompute, save() cycle cap, toJson cycle guard
 * and protected fields, bounded bulk concurrency. Runners are mocked — no
 * database involved (derived.test.ts / transforms.test.ts patterns).
 */

// ---- Fixtures (per-file: decorator registry is global per module registry) --

const NestedChild = defineModel('Nts597NestedChild', {
  id: { type: 'string', unique: true },
  role: {
    type: 'string',
    valid: ['ADMIN'],
    transform: { in: (value: unknown) => String(value).toUpperCase() },
  },
  a: { type: 'number' },
  b: { type: 'number' },
  total: {
    type: 'number',
    derived: {
      from: ['a', 'b'],
      compute: (entity) => (entity['a'] as number) + (entity['b'] as number),
    },
  },
  plot: { type: 'string' },
  emb: {
    type: 'any',
    vector: { dimensions: 3, from: 'plot', provider: () => Promise.resolve([9, 8, 7]) },
  },
})

const NestedParent = defineModel('Nts597NestedParent', {
  name: { type: 'string' },
  child: {
    type: 'relationships',
    relationship: 'CHILD_OF',
    direction: 'out',
    target: 'Nts597NestedChild',
  },
})

/** Hand-built schema (the derived.test.ts pattern): keys under my control */
function schemaWith(build: (schema: EntitySchema) => void): EntitySchema {
  const schema = new EntitySchema()

  schema.setLabels(['Nts597Update'])

  build(schema)

  return schema
}

function numberKey(schema: EntitySchema, key: string, primary = false): void {
  schema.addProperty(key)
  schema.getProperty(key).setType(PropertyType.NUMBER)

  if (primary) {
    schema.getProperty(key).setPrimaryKey(true)
  }
}

const Counter = defineModel('Nts597Counter', {
  id: { type: 'number', unique: true },
  hits: { type: 'number' },
  doubleHits: { type: 'number', derived: { from: ['hits'], cypher: 'this.hits * 2' } },
  hitsPlus: {
    type: 'number',
    derived: { from: ['hits'], compute: (entity) => (entity['hits'] as number) + 1 },
  },
})

@NodeEntity()
class Cycle597 {
  @Property({ type: 'string', unique: true })
  id!: string

  @OneToOne({ type: 'NEXT', target: () => Cycle597, direction: Direction.OUTGOING })
  next?: Cycle597
}

@NodeEntity()
class Json597Node {
  @Property({ type: 'string' })
  name?: string

  @Property({ type: 'string' })
  @Protected()
  secret?: string

  @OneToOne({ type: 'LINK', target: () => Json597Node, direction: Direction.OUTGOING })
  friend?: Json597Node
}

@NodeEntity()
class Json597Dag {
  @OneToOne({ type: 'A', target: () => Json597Node, direction: Direction.OUTGOING })
  left?: Json597Node

  @OneToOne({ type: 'B', target: () => Json597Node, direction: Direction.OUTGOING })
  right?: Json597Node
}

const BulkEmb = defineModel('Nts597BulkEmb', {
  plot: { type: 'string' },
  emb: { type: 'any', vector: { dimensions: 3, from: 'plot', provider: () => embedCall() } },
})

// ---- Runner mocks -----------------------------------------------------------

const record = (values: Record<string, unknown>): QueryRecord => ({
  get: (key) => values[key],
  has: (key) => Object.hasOwn(values, key),
  keys: Object.keys(values),
})

const node = (properties: Record<string, unknown>): GraphNode => ({
  elementId: '4:nts597',
  labels: ['Nts597'],
  properties,
})

/** Runner answering every statement with one __id record (merge / create paths) */
const idRunner = (): Runner =>
  ({
    run: vi.fn(async () => ({
      records: [record({ __id: '4:nts597' })],
      summary: { counters: {} },
    })),
  }) as unknown as Runner

/** Runner separating the required-property read (MATCH/RETURN) from the write (SET) */
const updateRunner = (
  stored: Record<string, unknown>,
): { runner: Runner; calls: { query: string; params: Record<string, unknown> }[] } => {
  const calls: { query: string; params: Record<string, unknown> }[] = []

  const runner: Runner = {
    run: async (query: string, params: Record<string, unknown>) => {
      calls.push({ query, params })

      if (query.includes('SET')) {
        return {
          records: [record({ __id: '4:nts597' })],
          summary: { counters: {} },
        } as QueryOutput
      }

      return { records: [record({ this: node(stored) })] } as QueryOutput
    },
  }

  return { runner: runner as Runner, calls }
}

let embedInFlight = 0
let embedPeak = 0

const embedCall = async (): Promise<number[]> => {
  embedInFlight += 1
  embedPeak = Math.max(embedPeak, embedInFlight)

  await new Promise((resolve) => setTimeout(resolve, 5))

  embedInFlight -= 1

  return [1, 2, 3]
}

// ---- Item 1: nested creates take the full write pipeline --------------------

describe('nested creates run the full write pipeline (NTS-597)', () => {
  it('the nested target derives, transforms and embeds before its properties are collected', async () => {
    const runnerSpy = idRunner()
    const service = new MergeService(runnerSpy)

    await service.save(
      {
        name: 'parent',
        child: { id: 'c1', role: 'admin', a: 10, b: 20, plot: 'hello' },
      },
      getModel(NestedParent)!,
    )

    const calls = (runnerSpy.run as ReturnType<typeof vi.fn>).mock.calls as [
      string,
      Record<string, unknown>,
    ][]

    // parent CREATE, child CREATE, relate
    expect(calls.length).toBe(3)

    const childParams = calls[1]![1]

    // `in` transform ran on the nested target
    expect(childParams['this_role']).toBe('ADMIN')
    // compute-derived value landed in the CREATE pattern (not just on the model)
    expect(childParams['this_total']).toBe(30)
    // embedding provider ran for the nested vector property
    expect(Object.values(childParams)).toContainEqual([9, 8, 7])
  })

  it('validation applies to nested targets', async () => {
    const service = new MergeService(idRunner())

    await expect(
      service.save(
        { name: 'parent', child: { id: 'c1', role: 'not-a-role' } },
        getModel(NestedParent)!,
      ),
    ).rejects.toThrow(/role/i)
  })
})

// ---- Item 2: update derives from the database row ---------------------------

describe('update derives from DB state (NTS-597)', () => {
  it('a stub entity no longer feeds the derive — stored sources come from the row', async () => {
    const schema = schemaWith((schema) => {
      numberKey(schema, 'id', true)
      numberKey(schema, 'a')
      numberKey(schema, 'b')
      numberKey(schema, 'sum')
      schema.getProperty('sum').setDerived({
        from: ['a', 'b'],
        compute: (entity) =>
          typeof entity['a'] === 'number' && typeof entity['b'] === 'number'
            ? (entity['a'] as number) + (entity['b'] as number)
            : undefined,
      })
    })

    const { runner, calls } = updateRunner({ a: 2, b: 3 })

    // the entity carries only identity: the in-memory record has no a/b at
    // all — the old code derived from it and silently skipped
    await new UpdateService(runner).update(schema, { id: 1 }, { a: 1 })

    const write = calls.find((call) => call.query.includes('SET'))!

    const setParam = Object.values(write.params).find(
      (value) => typeof value === 'object' && value !== null && 'sum' in (value as object),
    ) as Record<string, unknown>

    // sum = patched a (1) + stored b (3) read from the database
    expect(setParam['sum']).toBe(4)
    expect(setParam['a']).toBe(1)
    expect('b' in setParam).toBe(false)
  })

  it('the derive read is shared with the required-property refill', async () => {
    const schema = schemaWith((schema) => {
      numberKey(schema, 'id', true)
      numberKey(schema, 'age')
      schema.addProperty('name')
      schema.getProperty('name').setType(PropertyType.STRING)
      schema.getProperty('name').setRequired(true)
    })

    const { runner, calls } = updateRunner({ name: 'stored-name', age: 44 })

    await new UpdateService(runner).update(schema, { id: 1 }, { age: 9 })

    // exactly one read (shared by derive + refill) and one write
    expect(calls.length).toBe(2)

    const write = calls.find((call) => call.query.includes('SET'))!

    const setParam = Object.values(write.params).find(
      (value) => typeof value === 'object' && value !== null && 'name' in (value as object),
    ) as Record<string, unknown>

    expect(setParam['name']).toBe('stored-name')
  })

  it('no stored-state read when the patch neither triggers a derive nor needs a refill', async () => {
    const schema = schemaWith((schema) => {
      numberKey(schema, 'id', true)
      numberKey(schema, 'age')
    })

    const { runner, calls } = updateRunner({})

    await new UpdateService(runner).update(schema, { id: 1 }, { age: 9 })

    expect(calls.length).toBe(1)
  })
})

// ---- Item 3: increment recomputes derived properties over the counter -------

describe('increment recomputes derived properties over the counter (NTS-597)', () => {
  it('cypher-side derivations ride the increment statement, compute-side follow', async () => {
    const statements: { query: string; params: Record<string, unknown> }[] = []

    const neode = {
      writeCypher: vi.fn(async (query: string, params: Record<string, unknown>) => {
        statements.push({ query, params })

        return {
          records: [
            record({
              value: 6,
              this: node({ id: 1, hits: 6, hitsPlus: 0 }),
            }),
          ],
        } as QueryOutput
      }),
    } as unknown as INeode

    const repo = new Repository<Record<string, unknown>>(neode, Counter)

    const pk = repo.getPrimaryKey().getKey()

    const value = await repo.increment({ [pk]: 1 } as never, 'hits', 5)

    expect(value).toBe(6)

    // cypher-side: rendered after the counter bump, in the SAME statement
    const main = statements[0]!

    expect(main.query).toContain('this.`doubleHits`')
    expect(main.query.indexOf('this.`hits` = coalesce')).toBeLessThan(
      main.query.indexOf('this.`doubleHits`'),
    )

    // compute-side: recomputed from the post-write node in a follow-up write
    expect(statements.length).toBe(2)

    const patch = Object.values(statements[1]!.params).find(
      (param) => typeof param === 'object' && param !== null && 'hitsPlus' in (param as object),
    ) as Record<string, unknown>

    expect(patch['hitsPlus']).toBe(7)
  })
})

// ---- Item 4: save() caps cyclic nested graphs -------------------------------

describe('save() cycle cap (NTS-597)', () => {
  it('throws a descriptive NeodeError instead of overflowing the stack', async () => {
    const runnerSpy = idRunner()
    const service = new MergeService(runnerSpy)

    const cyclic: Record<string, unknown> = { id: 'c' }
    cyclic['next'] = cyclic

    const attempt = service.save(cyclic, getModel(Cycle597)!)

    await expect(attempt).rejects.toThrow(NeodeError)
    await expect(attempt).rejects.toThrow(/cyclic/)

    // bounded: one merge statement per level up to the cap, then the throw
    const runs = (runnerSpy.run as ReturnType<typeof vi.fn>).mock.calls.length

    expect(runs).toBe(MAX_SAVE_DEPTH)
  })
})

// ---- Item 5: toJson cycle guard and protected fields ------------------------

describe('toJson guards (NTS-597)', () => {
  it('a cyclic graph throws a descriptive NeodeError, not a stack overflow', () => {
    const a = new Json597Node()
    const b = new Json597Node()

    a.name = 'a'
    b.name = 'b'

    // self-cycle
    a.friend = a

    expect(() => toJson(a)).toThrow(NeodeError)
    expect(() => toJson(a)).toThrow(/cycle/)

    // mutual cycle
    a.friend = b
    b.friend = a

    expect(() => toJson(a)).toThrow(/cycle/)
  })

  it('a shared (non-cyclic) sub-graph serialises in full', () => {
    const shared = new Json597Node()
    const left = new Json597Node()
    const right = new Json597Node()

    shared.name = 'shared'
    left.name = 'left'
    right.name = 'right'
    left.friend = shared
    right.friend = shared

    const dag = new Json597Dag()

    dag.left = left
    dag.right = right

    const output = toJson(dag)

    expect((output['left'] as Record<string, unknown>)['name']).toBe('left')
    expect((output['right'] as Record<string, unknown>)['name']).toBe('right')
    expect(
      ((output['left'] as Record<string, unknown>)['friend'] as Record<string, unknown>)['name'],
    ).toBe('shared')
  })

  it('protected properties do not serialise', () => {
    const a = new Json597Node()

    a.name = 'adam'
    a.secret = 'hush'

    const output = toJson(a)

    expect(output['name']).toBe('adam')
    expect(output).not.toHaveProperty('secret')
  })
})

// ---- Item 6: bulk prepare bounds embedding-provider concurrency -------------

describe('bulk row preparation bounds provider concurrency (NTS-597)', () => {
  it('at most MAX_PREPARE_CONCURRENCY provider calls are in flight', async () => {
    embedInFlight = 0
    embedPeak = 0

    const runner: Runner = {
      run: async () => ({ records: [] }) as QueryOutput,
    } as unknown as Runner

    const rows = Array.from({ length: 30 }, (_unused, index) => ({
      plot: `row-${String(index)}`,
    }))

    await new BulkService(runner).createMany(BulkEmb, getModel(BulkEmb)!, rows)

    // concurrency happened, and it stayed bounded
    expect(embedPeak).toBeGreaterThan(1)
    expect(embedPeak).toBeLessThanOrEqual(8)
  })
})
