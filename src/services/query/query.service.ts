import type { Newable } from '../../meta/newable.js'
import type { Builder } from '../../query/index.js'
import type { QueryOutput, Runner } from '../../driver/types.js'
import { hydrateNode } from '../../utilities.js'
import { THIS_NODE } from '../../constants.js'
import { eagerNode } from '../../query/eager-utilities.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { isNodeLike } from '../type-guards.js'
import type { ReadFilterOptions } from './filters.js'

export class QueryService {
  protected readonly runner: Runner

  constructor(runner: Runner) {
    this.runner = runner
  }

  private getAndHydrate<T>(result: QueryOutput, constructor: Newable, schema: EntitySchema): T[] {
    return result.records.map((row) => {
      // With eager relationships the root column is a projection
      // map carrying its own eager values, without them a plain node
      const node = row.get(THIS_NODE)

      if (!isNodeLike(node)) {
        throw new TypeError(`The "${THIS_NODE}" column did not return a node value`)
      }

      return hydrateNode<T>(schema, constructor, node)
    })
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

    // Hydrate
    return result.records.length === 0 ? [] : this.getAndHydrate(result, constructor, schema)
  }
}
