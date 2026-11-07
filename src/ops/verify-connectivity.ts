/**
Connectivity checks (NTS-130) — verify a connection config can reach a
database, and wait until it can.

Pure functions on a config shape mirroring the one fromEnv() produces
(uri + auth + driver config + database). The orchestrator wires these as
facade methods; they construct a throwaway driver per check and close it.
*/

import { type AuthToken, driver as createDriver } from 'neo4j-driver'

/**
The connection config the checks run against — the shape fromEnv()
produces (uri + auth + driver config + database).
*/
export interface ConnectivityConfig {
  uri: string
  auth?: AuthToken
  /**
  Driver config (encryption, pool sizes, connectionTimeout, …)
  */
  config?: Record<string, unknown>
  /**
  Database the check targets — passed to the driver's verifyConnectivity
  */
  database?: string
}

/**
Rejected by waitUntilReachable when the deadline passes.
*/
export class ConnectivityTimeoutError extends Error {
  constructor(uri: string, timeout: number) {
    super(`Database at ${uri} was not reachable within ${String(timeout)}ms`)

    this.name = 'ConnectivityTimeoutError'
  }
}

/**
Check that a database is reachable right now, using a throwaway driver
constructed from the config (closed again afterwards).

Note the check runs with whatever connectionTimeout the config carries —
the driver's default applies otherwise.
*/
export async function verifyConnectivity(target: ConnectivityConfig): Promise<void> {
  const driver = createDriver(target.uri, target.auth, target.config)

  try {
    await driver.verifyConnectivity(
      target.database === undefined ? undefined : { database: target.database },
    )
  } finally {
    await driver.close()
  }
}

/**
Backoff and probe options for waitUntilReachable — every field optional.
*/
export interface WaitUntilReachableOptions {
  /**
  Total budget in ms; past it the call rejects with ConnectivityTimeoutError. Default 30_000.
  */
  timeout?: number

  /**
  First wait between attempts in ms; doubles after each failure up to 10x. Default 500.
  */
  interval?: number

  /**
  Probe override — lets callers (and tests) check reachability through
  something other than a Bolt driver, e.g. an embedded engine.
  */
  check?: (target: ConnectivityConfig) => Promise<void>
}

/**
Retry verifyConnectivity with exponential-ish backoff until the database
is reachable or the timeout elapses (then: ConnectivityTimeoutError).
*/
export async function waitUntilReachable(
  target: ConnectivityConfig,
  options: WaitUntilReachableOptions = {},
): Promise<void> {
  const timeout = options.timeout ?? 30_000
  const interval = options.interval ?? 500
  const check = options.check ?? verifyConnectivity

  const deadline = Date.now() + timeout
  let wait = interval

  for (;;) {
    const remaining = deadline - Date.now()

    if (remaining <= 0) {
      throw new ConnectivityTimeoutError(target.uri, timeout)
    }

    try {
      // Raced so a hung probe cannot blow the deadline (it settles
      // later; Promise.race already attached handlers to it)
      await Promise.race([check(target), rejectAfter(remaining, target.uri, timeout)])

      return
    } catch (error) {
      if (error instanceof ConnectivityTimeoutError) {
        throw error
      }

      await sleep(Math.min(wait, deadline - Date.now()))
      wait = Math.min(wait * 2, interval * 10)
    }
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function rejectAfter(ms: number, uri: string, timeout: number): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(new ConnectivityTimeoutError(uri, timeout))
    }, ms)

    // The loser of the race must not keep the process alive
    timer.unref()
  })
}
