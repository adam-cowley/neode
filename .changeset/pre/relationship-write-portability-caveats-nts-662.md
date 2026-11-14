---
'neode': patch
---

Docs (NTS-662): a "Relationship writes — portability caveats" section in the API reference covering the four notes consumers hit hand-writing Builder statements around relationship writes — compare `elementId`s not nodes (node `<>` is not implemented on every backend), render bare aliases when MERGEing MATCH-bound endpoints (`VariableAlreadyBound` on the embedded engine), never bind `undefined` values in UNWIND row maps, and restated relate() semantics (per-pair idempotency vs total-edge cardinality, bulk relate's rejected cardinalities). The embedded-engine notes table gains the two rows that differ between the embedded engine and a real server.
