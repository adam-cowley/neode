---
'neode': minor
---
Instance relationship query builder: `instance.related(key)` composes Builder-style verbs (where / orderBy / limit / skip) on top of one declared relationship traversal, with the terminal `find()` / `first()` / `count()` running it and hydrating the related entities through the regular hydration path. The related target's own global filters apply inside the traversal read — a filtered-out target yields an empty result, never an error (plain MATCH, no OPTIONAL MATCH). The scope's target type narrows from the relationship declaration.
