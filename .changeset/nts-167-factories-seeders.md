---
'neode': minor
---

Factories and seeders for entities (NTS-167): `FactoryBuilder.make(overrides)` builds unsaved instances with the same override > default > fake precedence as create; `FactoryBuilder.has(otherFactory, relationshipName)` composes another factory onto every created instance through the explicit relate path; a `Seeder` base class plus `runSeeders()` runner for idempotent seeding via `neode.mergeOn` (reruns update instead of duplicating); and `seededRandom(seed)`, a deterministic PRNG for reproducible fixtures inside `fake` generators.
