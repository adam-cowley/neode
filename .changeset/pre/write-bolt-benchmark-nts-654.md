---
'neode': patch
---

Write-path benchmark (NTS-654): `bench/write-bolt.bench.ts` measures the neode write path (`create()`, `createMany()`, `merge()`, `mergeMany()`) against raw Cypher over the neo4j-driver (Bolt) path on a local Neo4j testcontainer at 300 / 3,000 / 30,000 rows, recording wall-clock and statements per write (via QUERY_EXECUTED for the neode paths, explicit run counters for the raw baseline). A dated results record lives in bench/results/2026-11-11-write.md and the README gained a Benchmarks section pointing at bench/ and the recorded numbers. The bench runs manually (`vitest bench --project unit bench/write-bolt.bench.ts`) and is not part of the default test gate.
