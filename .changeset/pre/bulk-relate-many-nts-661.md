---
'neode': minor
---

Bulk relationship merging: `neode.relateMany(Entity, key, rows)` — the edge-writing counterpart of `mergeMany()`. Rows name the from- and to-nodes by primary-key value (`{ from, to, properties? }`), one UNWIND statement per chunk matches both endpoints and MERGEs the edge, so re-running the same rows never duplicates a relationship (relate()'s idempotency, per pair). Edge properties apply whether the MERGE created or matched the edge — the map-granularity form of relate()'s ON CREATE SET / ON MATCH SET (NTS-628) — and convert + validate through the shared edge-property pipeline (NTS-509/628). Restricted cardinalities (`one` / `zeroOrOne`) and edge-entity targets are rejected: use relate() per pair for those. Built for the JobStash acceptance harness's ingest path, where relationship rows arrive as ID pairs from CSV/JSON imports.
