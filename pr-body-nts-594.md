Fix (NTS-594) — [https://linear.app/neo4j/issue/NTS-594](https://linear.app/neo4j/issue/NTS-594)

## What

Four query-read fixes in the projection / load-spec machinery:

### 1. Multi-hop projection dedupe collapsed distinct nodes (the bug)

A multi-hop (`path:`) field-subset projection yields one element per matched path, and the same end node reached through two intermediate nodes appears twice (NTS-547). The hydration pass deduped those elements by **JSON value identity** — so two _distinct_ nodes whose projected fields happen to be identical collapsed into one element, silently dropping a node from the read result.

Now the query projection carries an `elementId` marker (`__EAGER_ID__: elementId(node)`) on multi-hop **many** field-subset comprehensions, and hydration dedupes by that node identity — value-identical distinct nodes all survive, and the same node hit through several paths still collapses to one. The marker is stripped during hydration, and a single-field subset still unwraps back to its scalar array, so reads without duplicates return exactly what they returned before. Single-hop projections cannot duplicate and are untouched (no marker, no dedupe).

### 2. `relationOrderArguments` now prefixes every accepted order-arg shape

Only the string and `{ field, order }` descriptor forms got the related node's variable prefixed; `{ name: 'DESC' }` maps and array forms (`['name']`, `[{ name: 'DESC' }]`) passed through with bare property names, rendering an ORDER BY over an unbound property. All accepted `OrderSpec` shapes are prefixed now.

### 3. Load-spec callback object-map `where` is prefixed

`(relation) => relation.where({ orderDate: 20 })` recorded the map and replayed it verbatim — keys were not prefixed with the related node's variable (unlike the string form). The map's keys are prefixed now.

### 4. Load-spec callbacks accept `withoutFilters`

`RelationQuery` gains `withoutFilters(names: string[])`: the decorated relation's read disables those named read filters, stacked on the parent read's `withoutFilters` — scoped to that relation only. It replays through `applyReadFilters` (the one filter composition point), not a Builder verb.

## Contract

- Public API preserved; `withoutFilters` on the callback view is additive and optional.
- Projections without duplicates keep identical (hydrated) output.
- Dedupe never merges two different nodes regardless of field equality.

## Tests

- `test/unit/projection-query.test.ts` — multi-hop many projections carry the marker; single-hop and singular projections stay plain.
- `test/unit/projection-hydrate.test.ts` — distinct nodes with identical single-field / multi-field values survive; the same node reached twice collapses; the marker never leaks into the DTO.
- `test/unit/load-spec-cypher.test.ts` — every order-arg shape prefixed; object-map `where` prefixed; target filter renders in the subquery and the callback's `withoutFilters` disables it while its own `where` still renders.
- `test/types/nts-560.test-d.ts` — the replayed verbs of `RelationQuery` exist on the real `Builder` (withoutFilters deliberately replays through `applyReadFilters` instead).

Gate: `pnpm build && pnpm lint && pnpm typecheck && pnpm test` — green.

Changeset: `.changeset/nts-594-read-projection-node-identity-dedupe.md` (`neode: patch`).
