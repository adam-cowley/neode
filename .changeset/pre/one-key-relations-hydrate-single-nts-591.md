---
'neode': patch
---
One-key relations now hydrate as the declared single value everywhere (the trimmed COLLECT load-spec fragment appends `[0]`), eager load-spec filter parameters bind in every branch (nested filters inside a `COLLECT { … }` subquery no longer fail with "Unbound parameter"), `related()` `first()`/`find()` on one-key relations push `LIMIT 1` into the Cypher instead of hydrating every row, and `load()` of a one-key relation orders by the target's primary key so the row it picks is deterministic.
