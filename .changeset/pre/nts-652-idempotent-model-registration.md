---
'neode': patch
---

Idempotent model registration for dev hot-reload (NTS-652): the model registry is process-global, and a second `defineModel()` under an already-registered name used to silently orphan the first model's schema (last-wins name index, the stale schema left registered in the metamodel). Registering a name twice now throws a descriptive error naming the fix, and `defineModel(name, schema, { idempotent: true })` returns the existing registration unchanged instead — the safe form for environments that re-evaluate the defining module (Nest HMR, Vitest watch mode). The existing definition wins in idempotent mode: schema changes need a process restart.
