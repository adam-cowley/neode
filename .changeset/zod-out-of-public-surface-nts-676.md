---
'neode': minor
---

1.0 audit (NTS-676): Zod is no longer part of neode's public API surface — it stays an implementation detail (a regular dependency, never re-exported), so a Zod major bump can never become a neode major bump. `ValidationError` now exposes `issues` — neode's own `{ path, rule, message }[]` shape, with `rule` named in neode's vocabulary (`required`, `type`, `format`, or the failing config rule such as `email` / `min` / `valid`) — replacing `details` (`{ message, path, type }[]`, whose `type` carried raw Zod issue codes); the never-populated Zod-typed `zodError` field is removed. The REST/Express error body serialises `issues`, and `rowToProperties` failures return `ValidationIssue[]`. A pluggable validator (Standard Schema) is a 1.x candidate, not built here.
