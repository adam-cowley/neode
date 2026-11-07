---

## 'neode': minor

Repository ergonomics for interface-first consumers: `update` renamed to `patch` so subclasses can implement domain interfaces that declare their own `update(id, input)` (NTS-454/458/459); `delete` and `increment` accept `{ ifExists: true }` to no-op instead of throwing on missing entities (NTS-455/457); new `countBy(property, params)` grouped-count helper (NTS-453); `cypher(query, params, { hydrate })` is now on `INeode` and usable inside transactions (NTS-452); atomic `increment` (NTS-435) and declarative `fulltext: true` + `Repository.search()` (NTS-436).
