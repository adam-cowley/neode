---
'neode': patch
---

Fixes Repository reads bypassing the projection system (NTS-501): `findAll()`/`findBy()` on a model declaring read-model decorators (`@RelatedOne`, `@RelatedMany`, `@RelationshipCount`, `@RelationshipExists`, `@LabelPresent`, `@Expression`) now route through the projection-aware read (`Neode#all`), so projected values hydrate the same way they do on `neode.all()` — previously they came back `undefined` through repository reads while the facade path projected correctly. `all()` joins the `INeode` scope (both the facade and `TransactionalService` already implemented it); plain models keep the local Builder path.
