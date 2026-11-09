import type { Newable } from './meta/newable.js'
import { getModels, getModel } from './meta/index.js'
import { EntitySchema, EntityType } from './meta/entity/entity-schema.js'
import { hydrateNode } from './utilities.js'
import { isGraphNode } from './services/type-guards.js'
import { Builder, type Direction } from './query/index.js'
import type { GraphNode, QueryOutput } from './driver/types.js'
import {
  assertAlias,
  assertCount,
  assertReference,
  assertDirection,
  assertDegrees,
  quote,
} from './query/quote.js'
import { applyReadFilters, type ReadFilterOptions } from './services/query/filters.js'

/**
One hop of a traversal (NTS-512): a relationship type, a direction, an
optional target model (label-filtering the hop) and optional variable
degrees (`*1..2`).
*/
export interface Hop {
  type: string
  direction: Direction
  /**
  The hop's end model — class or lazy thunk, normalised at hop()
  */
  target?: Newable | (() => Newable)
  degrees?: string
}

/**
One row of a traversal result: the hydrated entity per hop position,
starting with the origin node.
*/
export interface TraversalRow {
  nodes: unknown[]
}

/**
The traversal builder (NTS-512): typed multi-hop reads — chain hops, run,
get hydrated entities per hop position. Row semantics: one row per
matched path (variable-degree hops fan out).

Aggregate reads (NTS-547): declare `groupBy()` / `countDistinct()` and read
the result with `runAggregates()` — group aliases come back hydrated,
counts as numbers. `orderBy()` / `limit()` shape either mode.

Every aliased node whose model is known (the origin and each hop with a
target model) carries that model's named read filters (NTS-162, NTS-574):
soft-deleted and filtered-out nodes drop out of the paths and the counts.
`withoutFilters()` opts named filters out for the traversal; hops without a
target model have no model to filter by and stay unfiltered.

```ts
const rows = await neode.traverse(Product)
  .hop('SUPPLIED_BY', 'out', Supplier)
  .hop('COVERS', 'in', Territory, { degrees: '1..2' })
  .run()

rows[0].nodes // [Product, Supplier, Territory] hydrated

// co-purchase style: ranked, capped, excluding the origin's own edges
const ranked = await neode.traverse(Order)
  .where({ orderID })
  .hop('CONTAINS', 'out', Product)
  .hop('CONTAINS', 'in', Order)
  .hop('CONTAINS', 'out', Product)
  .exclude('t0', 'CONTAINS', 't3')
  .groupBy('t3')
  .countDistinct('t2', 'times')
  .orderBy('times', 'DESC')
  .limit(5)
  .runAggregates()
```
*/
export class TraverseBuilder {
  private readonly hops: Hop[] = []
  private startFilters: Record<string, unknown> = {}
  private readonly exclusions: string[] = []
  private groupAliases: string[] | undefined
  private countSpec: { alias: string; as: string } | undefined
  private orderSpec: { field: string; order?: 'ASC' | 'DESC' } | undefined
  private limitCount: number | undefined
  private filterOptions: ReadFilterOptions = {}

  private readonly runner: {
    run: (statement: string, parameters?: Record<string, unknown>) => Promise<QueryOutput>
  }

  private readonly start: () => Newable

  constructor(
    runner: {
      run: (statement: string, parameters?: Record<string, unknown>) => Promise<QueryOutput>
    },
    start: () => Newable,
  ) {
    this.runner = runner
    this.start = start
  }

  /**
  Assemble the MATCH + hops + WHERE the run methods share.
  */
  private buildPattern(): { builder: Builder; aliases: string[]; start: Newable } {
    const startConstructor = this.start()
    const startSchema = getModel(startConstructor)

    if (!(startSchema instanceof EntitySchema)) {
      throw new TypeError('traverse() requires a registered model')
    }

    const builder = new Builder()

    builder.match('t0', startSchema.getLabels(), this.startFilters)

    applyReadFilters(builder, startSchema, this.filterOptions, 't0')

    const aliases = ['t0']

    for (const [index, hop] of this.hops.entries()) {
      const alias = `t${String(index + 1)}`

      // A class is a function WITH a prototype; a lazy thunk is an arrow
      const targetConstructor =
        typeof hop.target === 'function' && hop.target.prototype !== undefined
          ? hop.target
          : undefined

      const targetSchema = targetConstructor === undefined ? undefined : getModel(targetConstructor)

      builder.relationship(hop.type, hop.direction, `r${String(index + 1)}`, hop.degrees)

      builder.to(alias, targetSchema instanceof EntitySchema ? targetSchema.getLabels() : false)

      if (targetSchema instanceof EntitySchema) {
        applyReadFilters(builder, targetSchema, this.filterOptions, alias)
      }

      aliases.push(alias)
    }

    for (const exclusion of this.exclusions) {
      builder.whereRaw(exclusion)
    }

    if (this.orderSpec !== undefined) {
      const { field, order } = this.orderSpec

      if (order === undefined) {
        builder.orderBy(field)
      } else {
        builder.orderBy(field, order)
      }
    }

    if (this.limitCount !== undefined) {
      builder.limit(this.limitCount)
    }

    return { builder, aliases, start: startConstructor }
  }

  /**
  Add one hop. `target` label-filters the hop's end node (a model class
  or a lazy thunk — forward refs); `degrees` ('1..2', '2', '...3') makes
  the hop variable-length.
  */
  hop(
    type: string,
    direction: Direction,
    target?: Newable | (() => Newable),
    degrees?: string,
  ): this {
    const hop: Hop = { type, direction }

    if (target !== undefined) {
      hop.target = target
    }

    if (degrees !== undefined) {
      hop.degrees = assertDegrees(degrees)
    }

    this.hops.push(hop)

    return this
  }

  /**
  Filter the start node on declared properties (applied at run()).
  */
  where(properties: Record<string, unknown>): this {
    this.startFilters = { ...this.startFilters, ...properties }

    return this
  }

  /**
  Disable named read filters for this traversal (NTS-574) — each name is
  independent, `softDelete` names the built-in @SoftDelete filter, as on
  every other read.
  */
  withoutFilters(...names: string[]): this {
    this.filterOptions = { ...this.filterOptions, withoutFilters: names }

    return this
  }

  /**
  Exclude a relationship between two in-scope aliases — rendered as
  `WHERE NOT (from)-[:TYPE]->(to)`. The "not already connected to the
  origin" clause (e.g. co-purchase recommendations: exclude products the
  origin order already contains).
  */
  exclude(fromAlias: string, type: string, toAlias: string): this {
    this.exclusions.push(
      `NOT (${assertAlias(fromAlias, 'exclude()')})-[:${quote(type)}]->(${assertAlias(toAlias, 'exclude()')})`,
    )

    return this
  }

  /**
  Aliases to group by (and return) in an aggregate read — `runAggregates()`.
  */
  groupBy(...aliases: string[]): this {
    this.groupAliases = [...(this.groupAliases ?? []), ...aliases]

    return this
  }

  /**
  Aggregate return: `count(DISTINCT alias) AS as` (the traversal version of
  "how many distinct paths reach the end through this node").
  */
  countDistinct(alias: string, as: string): this {
    this.countSpec = {
      alias: assertAlias(alias, 'countDistinct()'),
      as: assertAlias(as, 'countDistinct()'),
    }

    return this
  }

  /**
  Order the result rows (aggregate alias or node property).
  */
  orderBy(field: string, order?: 'ASC' | 'DESC'): this {
    assertReference(field, 'orderBy()')

    if (order !== undefined) {
      assertDirection(order, 'orderBy()')
    }

    this.orderSpec = order === undefined ? { field } : { field, order }

    return this
  }

  /**
  Cap the number of returned rows.
  */
  limit(limit: number): this {
    this.limitCount = assertCount(limit, 'limit')

    return this
  }

  /**
  Run the traversal: one row per matched path, each row the hydrated
  entities along it (origin first).
  */
  async run(): Promise<TraversalRow[]> {
    const { builder, aliases, start } = this.buildPattern()

    builder.return(...aliases)

    const { query, params } = builder.build()

    const output = await this.runner.run(query, params)

    return output.records.map((record) => {
      const nodes = aliases.map((alias, index) => {
        const value: unknown = record.get(alias)

        if (!isGraphNode(value)) {
          return value
        }

        return hydrateForNode(value, index === 0 ? start : undefined)
      })

      return { nodes }
    })
  }

  /**
  Run the traversal as an aggregate read: the `groupBy()` aliases returned
  per row (hydrated like run()'s positions) plus the `countDistinct()`
  count. Rows are `Record<string, unknown>` — group alias → entity,
  count alias → number.
  */
  async runAggregates(): Promise<Record<string, unknown>[]> {
    const countSpec = this.countSpec

    if (countSpec === undefined) {
      throw new TypeError('runAggregates() requires countDistinct(alias, as)')
    }

    const { builder, aliases } = this.buildPattern()

    const groups = this.groupAliases ?? []

    for (const alias of [...groups, countSpec.alias]) {
      if (!aliases.includes(alias)) {
        throw new TypeError(
          `Unknown traversal alias "${alias}" — this traversal defines: ${aliases.join(', ')}`,
        )
      }
    }

    builder.return(...groups, `count(DISTINCT ${countSpec.alias}) AS ${countSpec.as}`)

    const { query, params } = builder.build()

    const output = await this.runner.run(query, params)

    return output.records.map((record) => {
      const row: Record<string, unknown> = {}

      for (const alias of groups) {
        const value: unknown = record.get(alias)

        row[alias] = isGraphNode(value) ? hydrateForNode(value) : value
      }

      row[countSpec.as] = record.get(countSpec.as)

      return row
    })
  }
}

/**
Hydrate a node value with the registered model matching its labels (most
specific wins); position 0 passes the start model explicitly.
*/
function hydrateForNode(node: GraphNode, knownConstructor?: Newable): unknown {
  const constructor = knownConstructor ?? modelForLabels(node.labels)

  if (constructor === undefined) {
    return node
  }

  const schema = getModel(constructor)

  return schema instanceof EntitySchema ? hydrateNode(schema, constructor, node) : node
}

/**
The registered model whose labels are all present on the node (most specific wins).
*/
function modelForLabels(labels: string[]): Newable | undefined {
  let best: { constructor: Newable; score: number } | undefined

  for (const [constructor, schema] of getModels()) {
    const modelLabels = schema.getLabels()

    if (modelLabels.length === 0 || schema.getType() !== EntityType.NodeEntity) {
      continue
    }

    const matches = modelLabels.filter((label) => labels.includes(label)).length

    if (matches === modelLabels.length && (best === undefined || matches > best.score)) {
      best = { constructor, score: matches }
    }
  }

  return best?.constructor
}
