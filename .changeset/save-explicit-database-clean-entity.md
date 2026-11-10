---
'neode': patch
---

save(entity, database) no longer no-ops on a clean tracked entity when an
explicit database is given (NTS-621): saving a hydrated-but-unmodified
entity to a named database (the audit-copy pattern, `save(person, 'audit')`)
now performs the merge write there instead of silently doing nothing.
