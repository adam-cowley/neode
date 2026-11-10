---
'neode': minor
---

**Eager relationship creation on the write path (NTS-615)**: `create()` and `update()` accept an options object with a `relate` map — relationship key to saved target entity (or array of targets) — and relate them inside the same managed transaction as the write:

```ts
await db.create(TrailEvent, { ...props }, {
  relate: { tenant: tenantNode, submission: submissionNode },
})
```

One transaction, atomic from the caller's view: a failure mid-write rolls the node and its edges back together, so no orphan nodes. Edges are MERGE-based, so retries stay idempotent (the same guarantee `relate()` gives); cardinality is guarded per edge. The legacy `database` string third argument keeps working on both methods.
