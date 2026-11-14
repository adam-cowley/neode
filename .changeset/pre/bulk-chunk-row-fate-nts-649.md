---
'neode': minor
---

feat(bulk): report per-row fate when a chunk fails (NTS-649)

`createMany()` / `mergeMany()` now throw a `BulkChunkError` when a chunk's UNWIND fails: it carries `chunkIndex` and `failedRows` — each failing row's index in the full input plus its own error, found by re-running the chunk's rows one transaction per row with every diagnostic transaction rolled back (nothing the diagnosis touches commits). Every row of the failed chunk is unwritten — valid rows included — while earlier chunks stay committed; rows that only fail together (e.g. duplicate unique values within a chunk) report an empty `failedRows` with the reason in the message.
