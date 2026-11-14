---
'neode': minor
---

Builder gains full-text index DDL builders — `createFulltextIndex(label, properties)` and `dropFulltextIndex(label, properties)` — so schema DDL composes like queries through the same statement builders the SchemaService uses, alongside the existing constraint/index builders. Every DDL builder emits idempotent `IF NOT EXISTS` / `IF EXISTS` statements, unblocking callers that install per-instance schema (NTS-173).
