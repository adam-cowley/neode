---
'neode': minor
---
Per-call database option on the schema-management methods (NTS-645): `installSchema()`, `dropSchema()`, `inspectSchema()`, `schemaDiff()` and `applySchemaDiff()` accept a `database` that wins over the `setDatabase()` default — `neode.installSchema({ database: 'analytics' })` lands the constraints and indexes in the `analytics` database, no process-global `setDatabase()` needed. These paths previously ignored `setDatabase()` entirely (only the connection's own constructor database applied); they now honour it as the default, overridable per call. The no-argument `installSchema()` / `dropSchema()` forms behave exactly as before.
