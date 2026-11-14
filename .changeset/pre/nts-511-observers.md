---
'neode': minor
---

Adds model observers (NTS-511): `neode.observe(Model, { beforeSave, afterSave, beforeDelete, afterDelete })` — typed lifecycle hooks composed over the write paths of both scopes (facade and open transactions). `beforeSave` runs inside the write before the dirty diff (mutations count; an error fails the write and rolls the transaction back), `beforeDelete` can block a delete, `afterSave`/`afterDelete` run after hydration with `{ isNew, database }` context. Returns the off function.
