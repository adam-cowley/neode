---
'neode': patch
---

Per-relationship cascade deletes: the `cascade: true` key on a map-schema relationship definition (and a `cascade` option on `@OneToMany` / `@OneToOne`) is now honoured — a plain `delete()` cascades every annotated relationship, recursively, each level applying its own annotations, so deleting a Factory deletes its AssemblyLines, Machines and Parts while unannotated relationships (e.g. a Warehouse) survive. The delete-time options still win: `{ cascade: true }` takes every relationship on the schema, `{ cascade: false }` takes none. `Repository.delete()` now forwards those options too (it previously dropped everything but `force`, so cascade could not be opted into or out of there).
