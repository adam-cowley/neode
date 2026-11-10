---
'neode': minor
---
`BoundBuilder` read terminals for the one-row shape (NTS-613): `.first()` builds and runs the statement routed READ and resolves the first `QueryRecord` — undefined when the result set is empty — and `.scalar(name)` narrows that first row to one named column's value (undefined on an empty result). Replaces the `rows.records[0]?.get('…')` pattern at raw-read call sites; caller parameters merge over the builder's own params like the other terminals.
