---
'neode': minor
---

`@RelatedOne` / `@RelatedMany` accept a `path` — an array of `{ type, direction?, target? }` hops — for declarative multi-hop reads: the hops are chained in one pattern comprehension and the last hop ends at the projected node (`target()` label-filters it and type-checks `fields`; intermediate hops label-filter only when they declare a `target`). `fields` is required with `path` (projected form only). An optional `where` fragment filters elements inside the comprehension (`node` = final node, `this` = the annotated node). End nodes reached through several paths are deduplicated on hydration, so a two-hop "co-purchased products" projection lists each product once.
