---
'neode': patch
---

Fix Builder rendering of a statement that mixes parameterised `onCreateSet()`/`onMatchSet()` items with expression items (`onCreateSetExpr()`/`onMatchSetExpr()`): all ON CREATE SET items of a statement now coalesce into a single `ON CREATE SET` clause (same for ON MATCH SET), instead of rendering two separate clauses which is invalid Cypher (NTS-491).
