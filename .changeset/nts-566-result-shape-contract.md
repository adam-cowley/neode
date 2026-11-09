---
'neode': minor
---

Unified result-shape contract (NTS-566): every model read path now routes its rows through one shaping module, `src/services/query/shape.ts` — `shapeNodeRows` / `shapeProjectionRows` / `shapeEdgeRows` / `shapeScoredRows` — with no bespoke per-service row shaping left. The per-path contract (including how `with`-spec and eager loads nest exactly as declared) is documented in the new ADR, docs/decisions/0003-result-shapes.md, and asserted per read path in test/integration/result-shape.test.ts.

No result shape changes for existing callers — every path returns the same shapes as before. Two alignments came out of the audit, both strictly bug fixes: `Repository#findAll` on a model with static eager relationships no longer throws `TypeError` on the eager projection map (it hydrates, matching the facade's identical read), and `search`/`knn` share one scored-row shaper whose row filter can no longer shift a score onto the wrong entity when a row without a node value appears mid-stream.
