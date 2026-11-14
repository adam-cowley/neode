---
'neode': minor
---

Dirty-aware embedding recompute: on a tracked save (`save()` on a hydrated entity), a vector property declared with `from` + `provider` recomputes its embedding only when the source property is dirty — a clean source keeps its stored vector and costs no provider call, a dirty vector the user set explicitly still wins, and the freshly computed vector is persisted even though the instance itself did not change it (previously the stale stored embedding was silently kept).
