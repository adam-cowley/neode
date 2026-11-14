---
'neode': minor
---

Composite `REQUIRE` constraints in derived graph types (NTS-552): a property declared with `unique: ['a', 'b']` derives a named `REQUIRE (n.a, n.b) IS UNIQUE` item, and `index: ['a', 'b']` derives `IS KEY` — a graph type enforces rather than indexes, and key (existence + uniqueness) is the strongest composite constraint. Groups are deduplicated per property list (the flags may be declared on more than one of the group's properties) and work on relationship element types from the `@RelationshipEntity`'s properties too.
