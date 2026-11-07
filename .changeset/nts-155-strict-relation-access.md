---
'neode': minor
---
Strict relation access (NTS-155): hydrated entities now guard relationship properties that the load did not request — reading one throws `RelationNotLoadedError` (naming the `with` load-spec fix and `instance.load(...)`) when `setStrictRelationAccess(true)` is on, and returns `undefined` otherwise (the default, so existing neode-style code is unaffected until the switch is flipped). Loaded-and-empty relationships (`[]` for many, `undefined` for a singular match miss) stay readable in strict mode; static `eager` relationships always count as loaded. Works for decorator and map-defined models.
