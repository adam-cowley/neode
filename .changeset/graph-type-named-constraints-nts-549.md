---
'neode': minor
---

Named graph type constraints (NTS-549): derived uniqueness is hoisted out of the element type property maps into explicitly named `CONSTRAINT <label>_<prop>_unique FOR (n:<Label>) REQUIRE (n.<prop>) IS UNIQUE` items, so the constraint name is addressable in `DROP CONSTRAINT` / `ALTER CURRENT GRAPH TYPE DROP` (inline `IS UNIQUE` was only ever nameable by server-generated names, and dropping an element type leaves its uniqueness constraints behind). `dropGraphType()` now also drops the named items. `installGraphType()`/`dropGraphType()` accept `{ constraints: [...] }` for constraints on labels/types that are not identifying ones — derivation cannot produce those, and it is the only spelling for property existence/type constraints on non-identifying labels. Exports `GraphTypeConstraintDefinition`, `GraphTypeConstraintKind`, `graphTypeConstraintName`.
