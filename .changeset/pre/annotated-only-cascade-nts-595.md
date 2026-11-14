---
'neode': minor
---
Delete semantics tightened (NTS-595): `delete()` now cascades only into relationships explicitly annotated `cascade: true` — un-annotated relationships are detached, not deleted, so their targets survive (pass `{ cascade: true }` for the old delete-everything behaviour); the self-referential cascade walk is capped by the exported `MAX_CASCADE_DEPTH` (10, overridable per call with the `depth` option); `@SoftDelete` deletes are node-only and idempotent (a repeat soft delete never re-stamps `deletedAt`); and `deleteAll()` without filters is refused with a fix hint unless confirmed with `{ all: true }` (NTS-578 destructive-guard precedent). The cascade statement also no longer cross-multiplies rows across sibling cascade segments.
