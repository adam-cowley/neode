---
'neode': patch
---
Fix ambient-transaction rollback-only poisoning by pure-JS errors (only a driver-level statement failure poisons now), forward `queueTimeoutMs` through `forRelate`, and warn at `fromEnv` parse time on `NEO4J_ENCRYPTION` combined with a `+s`/`+ssc` scheme and on `NEO4J_MAX_TRANSACTION_RETRY_TIME` never being applied.
