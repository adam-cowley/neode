---
'neode': minor
---

Ontology Graph Spec import: `ontologySpecToSchemas()` maps a decoded Neo4j Ontology Graph Specification model (`@neo4j/ontology-graph-spec`, used as a devDependency in tests only) to neode map schemas — nodes to models, relationships to entries with direction derived from `from`/`to`, and constraints/indexes mapped where neode supports them. Register the output with `defineModel()` / `withDirectory()` as-is.
