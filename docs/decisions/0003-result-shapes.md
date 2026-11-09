# 0003 — Result shapes: every read returns data shaped like the query

**Status:** accepted (NTS-566)

## Context

The old neode returned `Record<alias, any>` bags — every caller hand-shaped
its own results. neode-ogm's read machinery instead returns typed entities
and named rows, and each read path landed its own row-shaping code:
`QueryService.getAndHydrate`, a copy of the same map in
`Repository.findAll`, the traversal row map in `LoadRelationService`, the
projection row map in `ProjectionService`, and a duplicated
`hasNode`/`scoreOf` pair in `search` and `knn`. Four row-mapping loops and
two scored-row pairs did the same job with drifting guards (the repository
checked `isGraphNode` where the services checked `isNodeLike`), so a new
read path had no obvious place to take its shape from.

## Decision

1. **One shaping module:** `src/services/query/shape.ts` — every model
   read path routes its rows through it; no per-service bespoke row
   shaping remains. Four functions, one per result shape:
   - `shapeNodeRows` — the alias column is a node (or an eager projection
     map), hydrated through the regular hydration path. Strict guard: a
     malformed column is a loud `TypeError`.
   - `shapeProjectionRows` — the alias column is the RETURN map
     projection, hydrated through `hydrateProjection` (projected kinds
     post-processed).
   - `shapeEdgeRows` — `{ node, edge }` rows (NTS-499's
     `RelationshipEdgeRead`).
   - `shapeScoredRows` — `{ entity, score }` rows (`ScoredEntity`), the
     row filter aligned with `hydrate()`'s so the entity/score zip can
     never silently misalign.

   The shape types themselves (`ScoredEntity`, `RelationshipEdgeRead`)
   live here too; their old homes re-export them, so import paths and the
   public API are unchanged.

2. **The shape table** — the documented contract per read path. The
   nesting of a result IS the nesting of the query's declaration
   (with-spec / eager loads nest as declared; a one-key reads
   `Item | undefined`, a many-key `Item[]`, empty included):

   | Read path                                            | Result shape                                                                                     | Shaped by                                                              |
   | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
   | `find(C, id)` / `findById`                           | `T \| undefined`                                                                                 | `shapeNodeRows` / `shapeProjectionRows` (with-spec / projected models) |
   | `all` / `get` / `getFirst` / `first`                 | `T[]` / `T \| undefined`                                                                         | same                                                                   |
   | `withinDistance`                                     | `T[]`                                                                                            | `shapeNodeRows`                                                        |
   | `find` / `all` / `findAll` with `with` spec          | `LoadedEntity<…>` — nested exactly as the spec declares                                          | `shapeProjectionRows`                                                  |
   | `search` / `knn` (and `Repository#search`)           | `ScoredEntity<T>[]` = `{ entity, score }[]`                                                      | `shapeScoredRows`                                                      |
   | `paginate` (offset)                                  | `Page<T>` = `{ items, total, page, limit, totalPages }`                                          | `shapeNodeRows` items + a COUNT row                                    |
   | `paginate` (cursor)                                  | `CursorPage<T>` = `{ items, nextCursor, hasMore }`                                               | `hydrate()` items                                                      |
   | `findManyAndCount`                                   | `ManyAndCount<T>` = `{ items, total }`                                                           | `shapeNodeRows` + a COUNT row                                          |
   | `chunk` / `lazy`                                     | `T[]` per page / `AsyncGenerator<T>`                                                             | `hydrate()`                                                            |
   | `instance.load(key)` / `load(spec)`                  | many `T[]`, one `T \| undefined` — materialized as own properties on the instance                | `shapeNodeRows`                                                        |
   | `related(k).find()` / `.first()` / `.count()`        | `T[]` / `T \| undefined` / `number`                                                              | `shapeNodeRows`                                                        |
   | `related(k).withRelationship().find()` / `.first()`  | `{ node, edge }[]` / `{ node, edge } \| undefined`                                               | `shapeEdgeRows`                                                        |
   | `Repository#find` / `findBy` / `findAll` / `where`   | entities (delegates to the facade with a spec or projected models; local Builder path otherwise) | `shapeNodeRows`                                                        |
   | `cypher()` / `readCypher` / `read()` / `write()` raw | `QueryOutput` = `{ records, summary }` (cypher() JSON-safes the values)                          | the driver layer                                                       |
   | the same with the `hydrate` option                   | `T[]` hydrated from the alias column (default `this`)                                            | `hydrate()`                                                            |
   | `traverse().run()` / `runAggregates()`               | `TraversalRow[]` = `{ nodes }[]` positional / `Record<string, unknown>[]`, hydrated by labels    | `traverse.ts`                                                          |

   Two boundaries are deliberate, not bespoke: the RAW paths return the
   server's own rows (user-shaped Cypher — the library cannot know the
   shape, and `hydrate()` is the lenient opt-in: rows without the alias
   column are skipped, extra columns feed eager hydration), and
   `traverse()` hydrates positionally by LABELS (it is label-polymorphic —
   no single schema/constructor to shape with).

3. **Alignments made** (same logical query, one shape now wins):
   - The repository's local Builder path guarded rows with `isGraphNode`
     where the service paths guard with `isNodeLike` (driver nodes AND
     eager projection maps). **`isNodeLike` won**: `Repository#findAll`
     on a model with static eager relationships now hydrates the eager
     projection map instead of throwing `TypeError` — matching the
     facade's identical read.
   - `search` and `knn` carried two copies of the scored-row shaping with
     drifting error messages; one `shapeScoredRows` remains. Its row
     filter is the strict node check (not the old lenient non-null check),
     so a mid-stream node-less row can no longer shift every subsequent
     score onto the wrong entity.
   - No result shape changed for any caller: every path returns the same
     shapes as before, now from one place.

## Consequences

- A new read path takes its shape from `shape.ts` — the shape table in
  this document and the per-path assertions in
  `test/integration/result-shape.test.ts` are the checklist.
- The raw-row boundary stays honest: `cypher()` remains the escape hatch
  where the caller owns the shape.
- Follow-up candidates, unchanged: `LoadedEntity` narrowing scope
  (decision 0002's ceiling), relationship-entity hydration in traversals.
