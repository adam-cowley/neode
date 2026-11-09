---
'neode': patch
---

Write-path correctness (NTS-597): nested creates run the full pipeline (derived values, `in` transforms, embeddings, validation), `update()` derives from database state through one shared read, `increment()` recomputes derived properties over the counter, `save()` caps cyclic nested graphs with a descriptive `NeodeError`, `toJson()` guards cycles and skips protected fields, and bulk row preparation bounds embedding-provider concurrency (chunks still commit separately).
