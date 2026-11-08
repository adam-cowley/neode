---
'neode': patch
---

Fixes the embedded engine's autocommit path failing during an open transaction (NTS-545): `readCypher`/`writeCypher`/`cypher` on the Relate provider now wait their turn on the same serialization queue `beginTransaction()` uses, instead of throwing "A transaction is open on this connection" while any transaction holds the slot — concurrent facade reads no longer intermittently 400 behind a write transaction. No deadlock risk: transaction-handle runs never come through the autocommit path.
