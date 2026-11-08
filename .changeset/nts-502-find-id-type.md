---
'neode': patch
---

Fixes the `find` id type on every scope (NTS-502): `Neode#find` and `TransactionalService#find` accepted only `string` ids while `INeode` and `Repository#find` always promised `string | number` — number-keyed models could not be read through an open transaction or typed facade calls. Both now accept `string | number`, matching the rest of the chain (`FindService` always took `unknown` and matched it as a parameter).
