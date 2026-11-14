---
'neode': minor
---
Adds `@CreatedAt()` and `@UpdatedAt()` property decorators (and the matching `createdAt` / `updatedAt` config options on `@Property` and the map API). Both are stamped server-side with `datetime()` so clocks never drift across clients: `@CreatedAt` is written once on create, `@UpdatedAt` on create and on every write (`update()`, `save()`, `mergeOn()`, bulk `createMany` / `mergeMany`). `@CreatedAt` properties are never rewritten by `update()`, and a no-op save on a clean tracked instance (NTS-157) touches neither timestamp — giving `paginate()`'s default `createdAt` keyset a property that is actually maintained.
