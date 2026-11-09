import type { Newable } from '../../meta/newable.js'
import type { Builder } from '../../query/index.js'
import type { Runner } from '../../driver/types.js'
import { THIS_NODE } from '../../constants.js'
import { eagerNode } from '../../query/eager-utilities.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { shapeNodeRows } from './shape.js'
import type { ReadFilterOptions } from './filters.js'

export class QueryService {
  protected readonly runner: Runner

  constructor(runner: Runner) {
    this.runner = runner
  }

  async returnFirst<T>(
    constructor: Newable,
    schema: EntitySchema,
    builder: Builder,
    filters?: ReadFilterOptions,
  ): Promise<T | undefined> {
    const results = await this.return<T>(constructor, schema, builder, 0, 1, filters)

    return results[0]
  }

  async return<T>(
    constructor: Newable,
    schema: EntitySchema,
    builder: Builder,
    skip?: number,
    limit?: number,
    filters?: ReadFilterOptions,
  ): Promise<T[]> {
    // Eager Loading: when the schema declares eager relationships the
    // root node is returned as a map projection nesting an eager pattern
    // comprehension per relationship, up to MAX_EAGER_DEPTH degrees deep.
    // The eager comprehensions carry the target models' read filters
    // (NTS-162) — a filtered-out related node reads as absent.
    const hasEagerRelationships = schema
      .getRelationships()
      .some((relationship) => relationship.getEager())

    builder.return(
      hasEagerRelationships
        ? `${eagerNode(1, THIS_NODE, schema, { builder, filters })} AS ${THIS_NODE}`
        : THIS_NODE,
    )

    // Skip and limit
    if (skip !== undefined && skip !== 0) {
      builder.skip(skip)
    }
    if (limit !== undefined && limit !== 0) {
      builder.limit(limit)
    }

    // Build Cypher
    const { query, params } = builder.build()

    const result = await this.runner.run(query, params)

    // Shape through the one result-shaping layer (NTS-566) — the root
    // column is a projection map carrying eager values when the schema
    // declares eager relationships, a plain node otherwise
    return shapeNodeRows<T>(result.records, schema, constructor, THIS_NODE)
  }
}
