import { Direction, NodeEntity, Primary, Property, SoftDelete } from '../../../src/index'
import type { QueryOutput } from '../../../src/driver/types'
import { NeodeError } from '../../../src/errors'
import { MAX_TRAVERSE_DEPTH, TraverseBuilder } from '../../../src/traverse'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Person {
  @Primary()
  @Property({ type: 'string' })
  id!: string
}

@NodeEntity()
@SoftDelete()
class Account {
  @Primary()
  @Property({ type: 'string' })
  id!: string
}

@NodeEntity()
class Widget {
  @Primary()
  @Property({ type: 'string' })
  id!: string
}

// ---- Runner stub capturing the generated Cypher -----------------------------

function capturingRunner(): {
  readonly query: string
  readonly params: Record<string, unknown>
  run: (statement: string, parameters?: Record<string, unknown>) => Promise<QueryOutput>
} {
  const state: { query: string; params: Record<string, unknown> } = {
    query: '',
    params: {},
  }

  return {
    get query() {
      return state.query
    },
    get params() {
      return state.params
    },
    run: async (statement, parameters) => {
      state.query = statement
      state.params = parameters ?? {}

      return { records: [], summary: {} } as unknown as QueryOutput
    },
  }
}

describe('traverse variable-length hops (NTS-593)', () => {
  it('dedupes per-path duplicates to distinct-node sets', async () => {
    const runner = capturingRunner()

    await new TraverseBuilder(runner, () => Person)
      .hop('OWNS', Direction.OUTGOING, Widget, '1..')
      .run()

    expect(runner.query).toBe(
      'MATCH (t0:Person)-[r1:`OWNS`*1..99]->(t1:Widget)\nRETURN DISTINCT t0, t1',
    )
  })

  it('keeps the path-row shape for fixed hops', async () => {
    const runner = capturingRunner()

    await new TraverseBuilder(runner, () => Person).hop('OWNS', Direction.OUTGOING, Widget).run()

    expect(runner.query).toBe('MATCH (t0:Person)-[r1:`OWNS`]->(t1:Widget)\nRETURN t0, t1')
  })

  it('caps open-ended ranges at MAX_TRAVERSE_DEPTH and leaves explicit bounds alone', async () => {
    const runner = capturingRunner()

    await new TraverseBuilder(runner, () => Person)
      .hop('OWNS', Direction.OUTGOING, Widget, '1..3')
      .hop('LIKES', Direction.OUTGOING, Widget, '..')
      .run()

    expect(runner.query).toBe(
      'MATCH (t0:Person)-[r1:`OWNS`*1..3]->(t1:Widget)-[r2:`LIKES`*..99]->(t2:Widget)\n' +
        'RETURN DISTINCT t0, t1, t2',
    )
    expect(MAX_TRAVERSE_DEPTH).toBe(99)
  })

  it('maxDepth() overrides the cap per traversal', async () => {
    const runner = capturingRunner()

    await new TraverseBuilder(runner, () => Person)
      .maxDepth(5)
      .hop('OWNS', Direction.OUTGOING, Widget, '1..')
      .run()

    expect(runner.query).toBe(
      'MATCH (t0:Person)-[r1:`OWNS`*1..5]->(t1:Widget)\nRETURN DISTINCT t0, t1',
    )
  })

  it('rejects an unsafe maxDepth', () => {
    const builder = new TraverseBuilder(capturingRunner(), () => Person)

    expect(() => builder.maxDepth(-1)).toThrow(NeodeError)
    expect(() => builder.maxDepth(1.5)).toThrow(NeodeError)
  })

  it('filters the mid-path nodes of a variable-length hop with the target model filters', async () => {
    const runner = capturingRunner()

    await new TraverseBuilder(runner, () => Person)
      .hop('OWNS', Direction.OUTGOING, Account)
      .hop('LINKS', Direction.OUTGOING, Account, '1..2')
      .run()

    expect(runner.query).toBe(
      'MATCH (t0:Person)-[r1:`OWNS`]->(t1:Account)\n' +
        'WHERE (NOT t1:`Deleted`)\n' +
        'MATCH p2 = (t1)-[r2:`LINKS`*1..2]->(t2:Account)\n' +
        'WHERE (NOT t2:`Deleted` AND all(mid IN tail(nodes(p2)) WHERE NOT mid:`Deleted`))\n' +
        'RETURN DISTINCT t0, t1, t2',
    )
  })

  it('binds the path on the first segment when the variable-length hop opens the traversal', async () => {
    const runner = capturingRunner()

    await new TraverseBuilder(runner, () => Person)
      .hop('OWNS', Direction.OUTGOING, Account, '1..')
      .run()

    expect(runner.query).toBe(
      'MATCH p1 = (t0:Person)-[r1:`OWNS`*1..99]->(t1:Account)\n' +
        'WHERE (NOT t1:`Deleted` AND all(mid IN tail(nodes(p1)) WHERE NOT mid:`Deleted`))\n' +
        'RETURN DISTINCT t0, t1',
    )
  })

  it('closes a bound path before the next hop appends to its segment', async () => {
    const runner = capturingRunner()

    await new TraverseBuilder(runner, () => Account)
      .hop('LINKS', Direction.OUTGOING, Account, '1..')
      .hop('LINKS', Direction.INCOMING, Account, '1..2')
      .run()

    expect(runner.query).toBe(
      'MATCH p1 = (t0:Account)-[r1:`LINKS`*1..99]->(t1:Account)\n' +
        'WHERE (NOT t0:`Deleted` AND NOT t1:`Deleted` AND ' +
        'all(mid IN tail(nodes(p1)) WHERE NOT mid:`Deleted`))\n' +
        'MATCH p2 = (t1)<-[r2:`LINKS`*1..2]-(t2:Account)\n' +
        'WHERE (NOT t2:`Deleted` AND all(mid IN tail(nodes(p2)) WHERE NOT mid:`Deleted`))\n' +
        'RETURN DISTINCT t0, t1, t2',
    )
  })

  it('a hop without a target model has no filters to apply (documented)', async () => {
    const runner = capturingRunner()

    await new TraverseBuilder(runner, () => Person)
      .hop('OWNS', Direction.OUTGOING, undefined, '1..')
      .run()

    expect(runner.query).toBe('MATCH (t0:Person)-[r1:`OWNS`*1..99]->(t1)\nRETURN DISTINCT t0, t1')
  })

  it('aggregate counts count distinct nodes over a variable-length hop', async () => {
    const runner = capturingRunner()

    await new TraverseBuilder(runner, () => Person)
      .hop('OWNS', Direction.OUTGOING, Widget, '1..')
      .countDistinct('t1', 'total')
      .runAggregates()

    expect(runner.query).toBe(
      'MATCH (t0:Person)-[r1:`OWNS`*1..99]->(t1:Widget)\nRETURN count(DISTINCT t1) AS total',
    )
  })
})
