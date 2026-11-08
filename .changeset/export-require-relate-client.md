---
'neode': patch
---

Exports `requireRelateClient()` next to `RelateConnectionProvider` (NTS-503): consumers embedding the engine in their own test suites can now open an in-memory database (`requireRelateClient().Database.open(':memory:')` → `new RelateConnectionProvider(database)`) without reaching into package internals.
