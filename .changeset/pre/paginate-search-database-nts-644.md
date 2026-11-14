---
'neode': minor
---
Per-call database option on the getRunner()-based reads (NTS-644): `paginate()`, `findManyAndCount()` and `search()` accept a `database` that wins over the `setDatabase()` default — `neode.paginate(Person, {}, { limit: 25, database: 'analytics' })` reads from the `analytics` database. These read paths previously ignored `setDatabase()` entirely (only the connection's own constructor database applied); they now honour it as the default, overridable per call (the `database` rides the paginate/findManyAndCount options bags and a new last argument on `search()`; inside an ambient transaction the override is ignored, as on every other path — the transaction is bound to one database at open time).
