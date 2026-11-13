---
'neode': minor
---
Database introspector: generate entity models from an existing graph — `neode.generateModels()` (and the `neode-generate` CLI) walk node labels, sample property values to infer types (absent properties optional, conflicting types a descriptive error), suggest the unique constraint's property as the primary key, and emit both decorated classes and map schemas without re-declaring constraints or indexes, so the generated models round-trip through `installSchema()` with no drift.
