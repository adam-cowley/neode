---
'neode': minor
---

BREAKING: `batch()` is renamed `runAll()` (NTS-624). The method always ran its statements sequentially inside ONE transaction — the batch was about atomicity (all-or-nothing commit, `TransactionError` with per-statement errors), never about throughput — but the name made callers (and LLMs) reach for it expecting pipelining or bulk writes. The signature is unchanged: `neode.batch([...])` → `neode.runAll([...])`. The throughput APIs keep their (correct) names: `createMany()` / `mergeMany()` for UNWIND-chunked bulk writes.
