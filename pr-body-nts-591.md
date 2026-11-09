Fixes NTS-591 — https://linear.app/neo4j/issue/NTS-591
Parent: NTS-586

## What

Three eager/relation-read bugs, all on the one-key (singular) relationship read paths:

### 1. One-key relations hydrate as arrays in trimmed load-spec levels

`specLevelPattern`'s trimmed branch renders a `COLLECT { MATCH … RETURN … ORDER BY … }` subquery — always a list. For a one-key relation the untrimmed comprehension appends `[0]` but the COLLECT branch did not, so `with: { card: { order: … } }` hydrated `card` as an array while the declared field type is `T | undefined`.

**Fix:** the trimmed branch appends `[0]` for one-key relations — the same shape the comprehension path gives. Many-key COLLECTs are unchanged.

### 2. Eager filter parameters dropped / unbound in two branches

`eagerPattern` (comprehension) and `specLevelPattern` (untrimmed) rendered the target's NTS-162 named filters onto a local pattern-builder, then copied its params onto the executing builder — but only when the `EagerFilterContext` carried one. In the trimmed COLLECT branch there was no such copy at all, and nested eager patterns inside `sub.return(fields)` bound their params on the **outer** statement's builder while their text compiled **inside** the subquery — `compileSub`'s fail-fast then rejected the statement with `Unbound parameter $tenant in a sub-query`.

**Fix:** a shared `bindEagerParameters` helper binds the pattern-builder's rendered params onto the executing builder in every branch; the trimmed branch passes `sub` as the nested fields' executing builder so its params namespace correctly; and a rendered param with no executing builder at all now fails fast with a descriptive `NeodeError` naming the fix, instead of an opaque driver error at execution.

### 3. One-key relation reads fetch every row and pick arbitrarily

- `RelatedQuery.first()` and `find()` on a one-key relation ran the traversal unbounded and took `hydrated[0]` in TypeScript. **Fix:** they push `LIMIT 1` into the Cypher (only when the caller recorded no `limit` of its own — a recorded limit stands).
- `load()` of a one-key relation had no ordering, so with more edges than the cardinality declares, `hydrated[0]` picked an arbitrary row. **Fix:** the loader orders by the target's primary key when the level gives no order — the picked row is deterministic.

## Contract

No behavior change for already-correct queries: many-key reads hydrate as lists, untrimmed one-key comprehensions keep their `[0]`, decorated (`loadSpecCalls`) reads are untouched, and a user's own `order`/`limit` always wins over the new defaults.

## Tests

- `test/unit/eager-params-nts-591.test.ts` — trimmed one-key COLLECT carries `[0]` with every nested filter param namespaced and bound (`sub0_tier`, `sub0_tenant`); trimmed many-key still a bare list; the two fail-fast errors (all four fail on `main`)
- `test/integration/instance-related.test.ts` — one-key `find()` emits exactly one statement carrying `LIMIT 1`; a recorded `limit` stands; many-key `find()` reads every row
- `test/integration/instance-load.test.ts` — one-key `load()` emits `ORDER BY this_card_node.id` + `LIMIT 1`; with two edges it deterministically loads the primary-key-smallest; an explicit level order overrides the primary key
