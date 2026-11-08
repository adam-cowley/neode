import type { Newable } from './meta/newable.js'
import { getModels, getModel } from './meta/index.js'
import { EntitySchema, EntityType } from './meta/entity/entity-schema.js'
import { hydrateNode } from './utilities.js'
import { isGraphNode } from './services/type-guards.js'
import { Builder, type Direction } from './query/index.js'
import type { GraphNode, QueryOutput } from './driver/types.js'

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

```ts
const rows = await neode.traverse(Product)
  .hop('SUPPLIED_BY', 'out', Supplier)
  .hop('COVERS', 'in', Territory, { degrees: '1..2' })
  .run()

rows[0].nodes // [Product, Supplier, Territory] hydrated
```
*/
export class TraverseBuilder {
  private readonly hops: Hop[] = []
  private startFilters: Record<string, unknown> = {}

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
      hop.degrees = degrees
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
  Run the traversal: one row per matched path, each row the hydrated
  entities along it (origin first).
  */
  async run(): Promise<TraversalRow[]> {
    const startConstructor = this.start()
    const startSchema = getModel(startConstructor)

    if (!(startSchema instanceof EntitySchema)) {
      throw new TypeError('traverse() requires a registered model')
    }

    const builder = new Builder()

    builder.match('t0', startSchema.getLabels(), this.startFilters)

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

      aliases.push(alias)
    }

    builder.return(...aliases)

    const { query, params } = builder.build()

    const output = await this.runner.run(query, params)

    return output.records.map((record) => {
      const nodes = aliases.map((alias, index) => {
        const value: unknown = record.get(alias)

        if (!isGraphNode(value)) {
          return value
        }

        return hydrateForNode(value, index === 0 ? startConstructor : undefined)
      })

      return { nodes }
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
