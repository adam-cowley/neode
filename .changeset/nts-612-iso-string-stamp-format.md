---
'neode': minor
---
`@CreatedAt()` and `@UpdatedAt()` accept `{ format: 'iso-string' }` (NTS-612): the server-side stamp renders `toString(datetime())` and the property stores an ISO-8601 string that compares lexically against client-supplied ISO strings — a temporal's own string form carries a `+00:00` offset and does not. The same write paths, merge semantics and explicit-value precedence apply in both modes; without the option the stored value is still the `datetime()` temporal.
