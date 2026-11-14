---
'neode': minor
---
`applySchemaDrift()` accepts `returnDriftAfter: true` to run one post-apply inspection pass and return `{ statements, driftAfter }` instead of the bare `SchemaResult[]` (NTS-659) — one probe serves apply + verification, so drift-repair callers no longer need a second `schemaDrift()` after applying. Opt-in: without the flag the return shape is unchanged.
