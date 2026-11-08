---
'neode': minor
---
Ambient transactions: `neode.transaction(callback, { routing?, database?, retries? })` binds the open transaction to AsyncLocalStorage, so facade/repository calls inside the callback join it without threading a handle — nested calls join the outer transaction, and a failure classified as transient (`TransientError`) retries the whole callback in a fresh transaction, so the callback must be idempotent. Requires a runtime with AsyncLocalStorage; the explicit-handle and managed APIs are unchanged for runtimes without it.
