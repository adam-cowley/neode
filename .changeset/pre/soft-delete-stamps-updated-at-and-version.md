---
'neode': patch
---

Soft delete and restore now stamp `@UpdatedAt` and bump `@Version` like every other write path (NTS-604): a guarded update hydrated before a concurrent soft delete no longer matches, and `updatedAt` reflects the last state change. Repeat soft deletes (and restores of live nodes) stay no-ops — no re-stamp, no double bump.
