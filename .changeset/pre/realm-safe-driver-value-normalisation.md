---
'neode': patch
---

Realm-safe driver value normalisation: driver temporal, duration and point values coming from a second copy of neo4j-driver (pnpm/link setups) are now recognised through the driver's own duck-typed guards instead of `instanceof` checks, so hydrated `datetime` (and other temporal) properties pass through `Neo4jConnectionProvider` untouched instead of being mangled into plain objects and failing validation on `save()`/`patch()`.
