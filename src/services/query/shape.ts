import type { GraphRelationship, QueryRecord } from '../../driver/types.js'
import { NeodeError } from '../../errors/index.js'
import { hydrate } from '../../hydrate.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import type { Newable } from '../../meta/newable.js'
import { hydrateProjection } from '../../projection/hydrate.js'
import { isGraphRelationship, isGraphNode, isNodeLike, isRecord } from '../type-guards.js'
import { hydrateNode } from '../../utilities.js'

// The ONE result-shaping layer (NTS-566): every library read path routes
// its result rows through this module, so a query's result shape is
// decided in one place — the nesting of the result IS the nesting of the
// query's declaration (with-spec / eager loads nest as declared). The
// per-path contract is catalogued in docs/decisions/0003-result-shapes.md
// and asserted per path in test/integration/result-shape.test.ts.

/**
A hydrated entity with the relevance score of the index that matched it
(full-text search, kNN)
*/
export interface ScoredEntity<T> {
  entity: T
  score: number
}

/**
One result row of an edge-returning related() read (NTS-499): the hydrated
related entity (`node`) alongside the traversed relationship itself
(`edge`, the normalized GraphRelationship — type, elementId, endpoints and
properties). The seed of the NTS-566 result-shape contract: flat, named,
no wrapper classes.
*/
export interface RelationshipEdgeRead<T> {
  node: T
  edge: GraphRelationship
}

/**
Shape model-read rows (FindService / FindByIdService / GetService /
WithinDistanceService / PaginateService items / the repository's local
Builder path / the related() traversal): the alias column is the node —
a plain GraphNode, or the eager projection map when the read nests eager
relationships — hydrated through the regular hydration path. The column
guard is strict: a malformed column is a loud TypeError, never a silent
skip.
*/
export function shapeNodeRows<T>(
  records: QueryRecord[],
  schema: EntitySchema,
  constructor: Newable,
  alias: string,
): T[] {
  return records.map((row) => {
    const node: unknown = row.get(alias)

    if (!isNodeLike(node)) {
      throw new TypeError(`The "${alias}" column did not return a node value`)
    }

    return hydrateNode<T>(schema, constructor, node)
  })
}

/**
Shape projection-read rows (ProjectionService): the alias column is the
RETURN map projection (projectionNode) — hydrated through
hydrateProjection so the projected kinds (related subsets, counts, exists,
label predicates, expressions, @Computed) post-process.
*/
export function shapeProjectionRows<T>(
  records: QueryRecord[],
  schema: EntitySchema,
  constructor: new (...arguments_: never[]) => T,
  alias: string,
): T[] {
  return records.map((row) => {
    const projection: unknown = row.get(alias)

    if (!isRecord(projection)) {
      throw new TypeError(`The "${alias}" column did not return a projection map`)
    }

    return hydrateProjection<T>(schema, constructor, projection)
  })
}

/**
Shape edge-returning traversal rows (related().withRelationship(), NTS-499):
the node column hydrates as usual and the edge column — the traversed
relationship in its normalized GraphRelationship shape — rides alongside
as `{ node, edge }`.
*/
export function shapeEdgeRows<T>(
  records: QueryRecord[],
  schema: EntitySchema,
  constructor: Newable,
  nodeAlias: string,
  edgeAlias: string,
): RelationshipEdgeRead<T>[] {
  return records.map((record) => {
    const node: unknown = record.get(nodeAlias)

    if (!isNodeLike(node)) {
      throw new TypeError(`The "${nodeAlias}" column did not return a node value`)
    }

    const edge: unknown = record.get(edgeAlias)

    if (!isGraphRelationship(edge)) {
      throw new TypeError(`The "${edgeAlias}" column did not return a relationship value`)
    }

    return { node: hydrateNode<T>(schema, constructor, node), edge }
  })
}

/**
Shape scored rows (search / knn): the alias column is the matched node and
the `score` column the index's relevance. Rows without a graph node under
the alias are skipped — the SAME filter hydrate() applies, so the surviving
rows zip 1:1 with the hydrated entities in order; a divergence between the
two filters is a loud error, not a silently misaligned row.
*/
export function shapeScoredRows<T>(
  records: QueryRecord[],
  constructor: new (...arguments_: never[]) => T,
  alias: string,
): ScoredEntity<T>[] {
  const nodeRows = records.filter((row) => hasNode(row, alias))

  // hydrate() re-filters with the same node check, in order
  const entities = hydrate<T>(constructor, { records: nodeRows }, alias)

  return entities.map((entity, index) => {
    const row = nodeRows[index]

    if (row === undefined) {
      throw new NeodeError('result rows and hydrated entities are misaligned')
    }

    return { entity, score: scoreOf(row) }
  })
}

/**
True while the row carries a graph node value under the alias — the same
check hydrate() applies to the rows it hydrates, so the scored zip stays
aligned row for row
*/
function hasNode(row: QueryRecord, alias: string): boolean {
  return row.has(alias) && isGraphNode(row.get(alias))
}

/**
The relevance / similarity score of a row (a float from the backend)
*/
function scoreOf(row: QueryRecord): number {
  const score: unknown = row.get('score')

  return typeof score === 'number' ? score : Number(score)
}
