## Observers fire on every write path (NTS-596)

Closes [NTS-596](https://linear.app/neo4j/issue/NTS-596) (child of NTS-587).

Until now only `save()` / `create()` / `delete()` / `relate()` ran the observer + event lifecycle, the registry was module-global keyed by exact constructor, and `extend()` models never fired. This makes the lifecycle uniform across every write path and scopes the registry per `Neode` instance.

### What changed

**Every write path now emits its event and runs the hooks (additive emission only — no event renamed or removed):**

- `update()` / `entity.update()` — `beforeSave` receives the mutable properties record (create-path contract; an error fails the write), then `NODE_UPDATED` + `afterSave` (`isNew: false`) fire once committed. The transaction-scope mirror (`tx.update()`) does the same, buffered until commit.
- `mergeOn()` (and everything riding it: `merge()`, `Repository#upsert`, `mergeMany()`) — `NODE_MERGED` with the re-hydrated node; `isNew` for `afterSave` is read from the statement's summary counters. The transaction-scope `tx.merge()` mirrors it.
- `createMany()` — `beforeSave` per row, then `NODE_CREATED` + `afterSave` per created entity after its chunk committed.
- `deleteAll()` — the matched nodes are hydrated first, so `beforeDelete` runs per entity (an error fails the whole bulk delete), then `NODE_DELETED` + `afterDelete` per entity once committed.
- Label writes — `addLabel()` / `removeLabel()` (the new `Neode#applyLabel` write) run the save lifecycle and emit `NODE_UPDATED`: a label change is an update, not a deletion.
- Soft deletes — the facade path now emits `NODE_UPDATED` (the node survives, the label + stamp are committed data) while keeping the documented `beforeDelete`/`afterDelete` hook contract; `entity.delete({ soft })` is routed through the facade `delete()` so it fires the same semantics and still returns the refreshed entity. The transaction-scope `delete()` stops emitting the documented-as-suppressed `NODE_DELETED` for soft deletes and emits `NODE_UPDATED` instead.
- `delete()` emission order fixed: the event fires BEFORE the `afterDelete` observer, so a hook error surfaces after the commit but never suppresses emission (the NTS-589 contract; `save()`/`create()` already had this order).

**Registry per instance, extended models honored:**

- `neode.observe()` registers in an instance-scoped `ObserverRegistry` — observers no longer leak across instances. The standalone `observe()` function keeps registering process-wide observers, which every instance still fires (fallback chain), so existing registrations are unchanged.
- `extendModel()` clones now record their base model, and observer lookups walk the clone lineage: observers registered on the base model fire for the clone's entities (clone first, then base).
- Explicit-handle transactions (`openReadTransaction()` / `openWriteTransaction()`), ambient `transaction()` scopes and managed scopes all receive the owning instance's registry.
- `clearObservers()` (test seam) drops instance-scoped registrations too.

### Docs

- `src/common/events.ts` JSDoc table + `docs/api-reference.md`: `NODE_MERGED` is no longer reserved (it is the `mergeOn` event), and the emitted-by column reflects the new paths. Agent docs regenerated (`pnpm docs:agents`).

### Tests

- `test/unit/observers-nts-596.test.ts` — 22 unit tests over a fake provider: per-instance scoping, global fallback, `clearObservers()` reach, clone lineage (`getExtendedFrom` + registry walk + facade save of a clone), `update()`/`mergeOn()`/`createMany()`/`mergeMany()`/`deleteAll()` events and hooks, soft-delete `NODE_UPDATED`, label writes, tx-scope mirrors, and the hook-error-never-suppresses-emission order.
- `test/integration/observers.test.ts` — 12 integration tests over the embedded backend covering every new path end-to-end (real hydration, real label state, `Repository#upsert`, blocked bulk delete, hook error after commit with the data staying committed).

### Known limits (documented in code)

- `mergeMany` cannot observe a row's create-vs-match, so `afterSave` sees `isNew: false` there — `NODE_MERGED` is the event.
- Nodes reached through cascaded deletes (inside the parent's delete statement) fire no per-node hooks — the parent write's lifecycle governs, consistent with the existing `Repository#deleteAll` shortcut note.
- `Repository#restore()` (label removal via a raw statement) still emits nothing; it was not in the NTS-596 path list.
