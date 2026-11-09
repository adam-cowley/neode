Fixes NTS-589 — https://linear.app/neo4j/issue/NTS-589 (transaction & driver leftovers from NTS-576 / NTS-582).

## What changed

**Ambient transaction rollback-only poison scope** (`src/transaction/ambient.ts`): a joined call that threw used to mark the shared transaction rollback-only on ANY error — including pure-JS validation failures that never reached the driver (nothing was written, yet a callback that handled the error got its commit replaced by a rollback + a "marked rollback-only" error). The scope now tracks whether a statement run by a joined call actually failed on the driver (`statementFailed`, set in the join handle's `run`) and only marks rollback-only then — matching the driver's own poison semantics, where a failed statement inside an explicit transaction makes the server refuse the commit. An explicit `rollback()` on the join handle still marks the scope rollback-only. Both behaviours are unit-tested (`test/unit/transaction-nts-582.test.ts`).

**`forRelate` forwards `queueTimeoutMs`** (`src/neode.service.ts`, `src/driver/types.ts`): the option was only reachable by constructing `RelateConnectionProvider` directly. `ConnectionOptions` now carries an optional `queueTimeoutMs` (ignored by non-Relate providers) that `forRelate` forwards — backwards compatible, tested through the facade with a timeout that proves the value reached the provider (`test/unit/driver/relate-queue.test.ts`).

**`fromEnv` guards** (`src/from-env.ts`):

- `NEO4J_ENCRYPTION` combined with a `+s` / `+ssc` URI scheme made the driver throw ("encrypted can't be combined with…") only at driver-construction time. `configFromEnv` now drops the env-derived `encrypted` value with a clear warning at parse time — the scheme already decides encryption.
- `NEO4J_MAX_TRANSACTION_RETRY_TIME` mapped to a driver option the OGM never applies (neode opens unmanaged transactions). It still passes through to the driver, but a one-line warning at parse time points at the `retries` option of `transaction()` instead.

**Missing test added**: the Integer-out-of-safe-range throw in `neo4j-connection-provider.ts` (`safeToNumber`, NTS-582 behaviour) had no unit test — added in `test/unit/driver/neo4j-connection-provider.test.ts`.

## Documented only (no behaviour change)

- `after*` hook errors surface **after** the data has committed — contract stated in the `ModelObservers` JSDoc (`src/observers.ts`).
- A facade call inside `transaction()` passing a per-call `database` different from the outer transaction **throws** (was still described as "ignored" in the `TransactionOptions.database` JSDoc) — corrected, plus one line in `MIGRATION.md` §5.

## Left for humans (deliberately out of scope)

- Schema methods joining the ambient transaction vs throwing — needs a design call.
- Exponential retry backoff — policy change.
- `withDirectory` ESM / `.ts` loading.

## Gate

`pnpm lint && pnpm typecheck && pnpm test` — green (1778 tests; the new poison test verified to fail without the fix).
