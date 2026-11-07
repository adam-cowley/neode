---

## 'neode': patch

Query Builder: chaining `create()`/`merge()` and then `match()` now emits a `WITH *` between the updating and reading clauses — Neo4j rejects the query without it ("WITH is required between CREATE and MATCH") (NTS-485).
