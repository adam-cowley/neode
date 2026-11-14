---
'neode': minor
---

Managed transactions (NTS-561): `inReadTransaction()` / `inWriteTransaction()` now commit the transaction when the work resolves — a throw rolls back, as before. The caller no longer has to remember `tx.commit()`: an uncommitted callback no longer leaks an open transaction (which deadlocked the next write on the embedded engine's single-transaction connection). Migration note: an explicit `commit()` inside the callbacks is now optional (existing code keeps working — a second `commit()` is a no-op), a `rollback()` after a commit does nothing (the commit stands, so "committed then threw" no longer surfaces a rollback error), and committing after a rollback throws — a failed transaction cannot commit.
