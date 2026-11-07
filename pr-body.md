Closes NTS-165 — https://linear.app/neo4j/issue/NTS-165

## What

`@CreatedAt()` and `@UpdatedAt()` property decorators (plus the matching `createdAt` / `updatedAt` config options on `@Property` and the map API, so both schema surfaces are covered). Both stamps are written server-side with `datetime()` — the database clock, so clocks never drift across clients:

- `@CreatedAt` — written once on create. `update()` guards it like a primary key, so it is never rewritten.
- `@UpdatedAt` — written on create and on every write: `save()` (MERGE match path), `mergeOn()`, `update()`, and bulk `createMany` / `mergeMany` (via `coalesce(row.key, datetime())`, so an explicitly provided row value wins).

Dirty tracking (NTS-157) composes correctly: a no-op `save()` / `update()` on a clean tracked instance still runs no query and touches neither timestamp — the stamps only ride along on a real write. In `save()` / `mergeOn()` the stamps render as `ON CREATE SET` / `ON MATCH SET` expressions before the plain `SET` clauses, so an explicitly written timestamp value in the same statement still overrides the stamp.

This also gives `paginate()`'s keyset cursor — which defaults to `createdAt` — a property that is actually maintained without hand-rolled `@Default` / `@OnCreateSet` boilerplate.

## How it's tested

- `test/unit/timestamps.test.ts` — decorator + map-API registration (stacking with `@DateTime`, config keys never leak into validation rules), and the Cypher shape of every write path against a mock runner: CREATE pattern stamps, MERGE `ON CREATE SET` / `ON MATCH SET` stamps, the empty-dirty-set no-op guard, `update()` stamping `updatedAt` while never writing `createdAt`, and the bulk query builders.
- `test/integration/timestamps.test.ts` — end-to-end against the embedded engine: create stamps both server-side, clean save is a no-op, dirty save bumps `updatedAt` while `createdAt` survives byte-for-byte, `update()` and `mergeOn()` match paths, and bulk `createMany` / `mergeMany` rows come back stamped.

## Notes

- Existing `buildCreateQuery` / `buildMergeQuery` signatures gained optional stamp parameters — no breaking change, and stamp-free output is byte-identical to before.
- `AGENTS.md` / `llms*.txt` regeneration landed as its own `chore(docs)` commit (main's copy was stale).
