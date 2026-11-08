import { Direction, NodeEntity, Primary, Property } from '../../../src/index'
import type { QueryOutput } from '../../../src/driver/types'
import { TraverseBuilder } from '../../../src/traverse'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Order {
  @Primary()
  @Property({ type: 'number' })
  orderID!: number
}

@NodeEntity()
class Product {
  @Primary()
  @Property({ type: 'number' })
  productID!: number
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

describe('traverse aggregates (NTS-547)', () => {
  it('renders the co-purchase shape: exclude, group, count, order, limit', async () => {
    const runner = capturingRunner()

    await new TraverseBuilder(runner, () => Order)
      .where({ orderID: 10248 })
      .hop('CONTAINS', Direction.OUTGOING, Product)
      .hop('CONTAINS', Direction.INCOMING, Order)
      .hop('CONTAINS', Direction.OUTGOING, Product)
      .exclude('t0', 'CONTAINS', 't3')
      .groupBy('t3')
      .countDistinct('t2', 'times')
      .orderBy('times', 'DESC')
      .limit(5)
      .runAggregates()

    expect(runner.query).toBe(
      'MATCH (t0:Order { orderID: $t0_orderID })-[r1:`CONTAINS`]->(t1:Product)' +
        '<-[r2:`CONTAINS`]-(t2:Order)-[r3:`CONTAINS`]->(t3:Product)\n' +
        'WHERE (NOT (t0)-[:`CONTAINS`]->(t3))\n' +
        'RETURN t3, count(DISTINCT t2) AS times\n' +
        'ORDER BY times DESC\n' +
        'LIMIT 5',
    )
    expect(runner.params).toEqual({ t0_orderID: 10248 })
  })

  it('without groupBy the count is a global aggregate', async () => {
    const runner = capturingRunner()

    await new TraverseBuilder(runner, () => Order)
      .hop('CONTAINS', Direction.OUTGOING, Product)
      .countDistinct('t1', 'total')
      .runAggregates()

    expect(runner.query).toBe(
      'MATCH (t0:Order)-[r1:`CONTAINS`]->(t1:Product)\nRETURN count(DISTINCT t1) AS total',
    )
  })

  it('runAggregates without countDistinct rejects', async () => {
    const runner = capturingRunner()

    await expect(
      new TraverseBuilder(runner, () => Order)
        .hop('CONTAINS', Direction.OUTGOING, Product)
        .runAggregates(),
    ).rejects.toThrow('countDistinct')
  })

  it('unknown group/count aliases reject with the known set', async () => {
    const runner = capturingRunner()

    await expect(
      new TraverseBuilder(runner, () => Order)
        .hop('CONTAINS', Direction.OUTGOING, Product)
        .groupBy('t9')
        .countDistinct('t1', 'total')
        .runAggregates(),
    ).rejects.toThrow('Unknown traversal alias "t9"')
  })

  it('run() keeps its path-row shape (aggregates do not disturb it)', async () => {
    const runner = capturingRunner()

    await new TraverseBuilder(runner, () => Order)
      .where({ orderID: 1 })
      .hop('CONTAINS', Direction.OUTGOING, Product)
      .run()

    expect(runner.query).toBe(
      'MATCH (t0:Order { orderID: $t0_orderID })-[r1:`CONTAINS`]->(t1:Product)\nRETURN t0, t1',
    )
  })
})
