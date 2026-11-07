---
'neode': minor
---

Builder: inline pattern properties can now carry raw Cypher expressions via `RawExpression` (`merge('cat', 'Category', { slug: new RawExpression('slug') })` renders `MERGE (cat:Category { slug: slug })` for FOREACH-bound variables, without parameterising the value), and `relationship()` accepts a `properties` argument rendered inline in the relationship pattern — parameterised for plain values, verbatim for `RawExpression` — so `CREATE (a)-[:PROVIDED_ANSWER { answers: row.answers }]->(q)` and expression-valued `ON CREATE SET` / `ON MATCH SET` (`onCreateSetExpr` / `onMatchSetExpr`) need no hand-written Cypher.
