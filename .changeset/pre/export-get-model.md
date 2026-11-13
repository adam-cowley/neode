---
'neode': patch
---

Exports `getModel()`/`getModels()` (metamodel access) and `validate()` (schema-driven Zod validation) — consumers building statements outside the OGM services can validate values against a model's schema and resolve models from constructors. Found building the Northwind demo's single-statement order placement, which validates its edge rows against the `OrderLine` schema before a raw Builder statement.
