---
'neode': minor
---

Query builder: `create()` and `merge()` accept extra labels for multi-label nodes — pass an array as the second argument (`create('p', ['Person', 'Admin'], { … })` renders `CREATE (p:Person:Admin { … })`; MERGE matches on all labels). Model-defined labels (`@NodeEntity({ labels: [...] })` / the map API's `labels` key) already flow into every facade create/merge — now pinned by tests and documented (NTS-486).
