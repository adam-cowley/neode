/* eslint-disable unicorn/name-replacements -- "Neo4j" is the product name (the rule's `j` -> `index` replacement misfires on it), and fromEnv / EnvConnectionConfig are the documented public API names */
/**
fromEnv (neode parity): load a .env file, map the NEO4J_* variables onto
a driver config and construct a Neode over a neo4j-driver Driver.

Lives apart from utilities.ts on purpose — it constructs the Neode
service, and utilities is imported BY the service layer.
*/
import type { DotenvConfigOutput } from 'dotenv'
import { auth, type Config, driver as createDriver, logging } from 'neo4j-driver'
import { createRequire } from 'node:module'
import { Neo4jConnectionProvider } from './driver/neo4j-connection-provider.js'
import { NeodeError } from './errors/index.js'
import { Neode } from './neode.service.js'
import { isRecord } from './services/type-guards.js'

/**
The dotenv module surface loadDotenv uses. The import is TYPE-ONLY —
it never loads dotenv at runtime (NTS-599: importing neode must not pay
for dotenv, only fromEnv() reads env config). The sync require below keeps
fromEnv() synchronous — a dynamic import() would force it async, breaking
the documented API — and dotenv ships CJS, so it is the same module
`import` would return.
*/
interface DotenvModule {
  config: (options?: { path?: string }) => DotenvConfigOutput
}

const requireCjs = createRequire(import.meta.url)

function isDotenvModule(value: unknown): value is DotenvModule {
  return isRecord(value) && typeof value['config'] === 'function'
}

function loadDotenv(): void {
  const module_: unknown = requireCjs('dotenv')

  if (!isDotenvModule(module_)) {
    throw new NeodeError('The dotenv module resolved from node_modules is not the expected shape')
  }

  module_.config()
}

export interface EnvConnectionConfig {
  uri: string
  auth: ReturnType<typeof auth.basic> | undefined
  config: Record<string, unknown>
  database: string
  enterprise: boolean
}

function warnIgnoring(environmentVariable: string, reason: string): void {
  console.warn(`fromEnv: ignoring ${environmentVariable} — ${reason}`)
}

// The full TrustStrategy union in neo4j-driver 6 (legacy driver 4/5 values
// such as TRUST_SIGNED_CERTIFICATES are no longer part of it)
const TRUST_STRATEGIES = [
  'TRUST_ALL_CERTIFICATES',
  'TRUST_CUSTOM_CA_SIGNED_CERTIFICATES',
  'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES',
]

type LogLevel = 'error' | 'warn' | 'info' | 'debug'

const LOG_LEVELS: Set<string> = new Set<LogLevel>(['error', 'warn', 'info', 'debug'])

function isLogLevel(value: string): value is LogLevel {
  return LOG_LEVELS.has(value)
}

/**
An env var's value, with the empty string treated as unset (the `||`
fallback semantics fromEnv has always had).
*/
function envValue(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = environment[key]

  return value === undefined || value === '' ? undefined : value
}

/**
Pure process-env → connection mapping used by fromEnv().

`driverConfig` is merged verbatim over the env-derived config — any option
neo4j.driver accepts can be passed even when no NEO4J_* variable maps to
it. Explicit values win over env-derived ones; `undefined` entries are
skipped so a programmatically-built config does not clobber env values.

Audited against the neo4j-driver 6 config surface:
- `encrypted` / `trust` / `trustedCertificates` still exist, but the legacy
  `TRUST_SIGNED_CERTIFICATES` value was dropped from `TrustStrategy`
  (passed through with a warning).
- `knownHosts` and `loadBalancingStrategy` were removed entirely —
  warn + ignore.
- `logging` must be a `{ level, logger }` object; a raw string throws
  "Illegal logger function" at driver construction.
*/
export function configFromEnv(
  environment: NodeJS.ProcessEnv,
  driverConfig: Config = {},
): EnvConnectionConfig {
  const protocol = envValue(environment, 'NEO4J_PROTOCOL') ?? 'bolt'
  const host = envValue(environment, 'NEO4J_HOST') ?? 'localhost'
  const port = envValue(environment, 'NEO4J_PORT') ?? '7687'
  const uri = envValue(environment, 'NEO4J_URI') ?? `${protocol}://${host}:${port}`

  const config: Record<string, unknown> = {}

  const ints: Record<string, string> = {
    NEO4J_MAX_CONNECTION_POOLSIZE: 'maxConnectionPoolSize',
    NEO4J_MAX_TRANSACTION_RETRY_TIME: 'maxTransactionRetryTime',
    NEO4J_MAX_CONNECTION_LIFETIME: 'maxConnectionLifetime',
    NEO4J_CONNECTION_TIMEOUT: 'connectionTimeout',
    NEO4J_CONNECTION_ACQUISITION_TIMEOUT: 'connectionAcquisitionTimeout',
  }

  for (const [setting, key] of Object.entries(ints)) {
    const raw = envValue(environment, setting)

    if (raw === undefined) {
      continue
    }

    const parsed = Number(raw)

    if (Number.isFinite(parsed)) {
      config[key] = parsed
    } else {
      warnIgnoring(setting, `"${raw}" is not a finite number`)
    }
  }

  if (envValue(environment, 'NEO4J_MAX_TRANSACTION_RETRY_TIME') !== undefined) {
    console.warn(
      'fromEnv: NEO4J_MAX_TRANSACTION_RETRY_TIME is passed to the driver, but neode opens its own unmanaged transactions and never applies it — control transaction retries with the `retries` option of transaction() instead',
    )
  }

  const disableLosslessIntegers = envValue(environment, 'NEO4J_DISABLE_LOSSLESS_INTEGERS')

  if (disableLosslessIntegers !== undefined) {
    config['disableLosslessIntegers'] = disableLosslessIntegers === 'true'
  }

  const encryption = envValue(environment, 'NEO4J_ENCRYPTION')

  if (encryption !== undefined) {
    if (encryption === 'true' || encryption === 'ENCRYPTION_ON') {
      config['encrypted'] = true
    } else if (encryption === 'false' || encryption === 'ENCRYPTION_OFF') {
      config['encrypted'] = false
    } else {
      warnIgnoring('NEO4J_ENCRYPTION', `unknown value "${encryption}"`)
    }

    // A +s / +ssc scheme implies encryption — the driver rejects an explicit
    // `encrypted` next to it, so the env value must not reach it (NTS-589)
    if (config['encrypted'] !== undefined && /^(neo4j|bolt)\+s(sc)?:\/\//.test(uri)) {
      delete config['encrypted']

      warnIgnoring(
        'NEO4J_ENCRYPTION',
        `"${uri}" uses a +s / +ssc scheme, which already decides encryption — the driver rejects an explicit \`encrypted\` there`,
      )
    }
  }

  const trust = envValue(environment, 'NEO4J_TRUST')

  if (trust !== undefined) {
    if (TRUST_STRATEGIES.includes(trust)) {
      // A driver 6 trust strategy — pass through untouched
    } else {
      console.warn(
        `fromEnv: NEO4J_TRUST "${trust}" is not a driver 6 trust strategy (${TRUST_STRATEGIES.join(', ')}) — passing through as-is`,
      )
    }

    config['trust'] = trust
  }

  const trustedCertificates = envValue(environment, 'NEO4J_TRUSTED_CERTIFICATES')

  if (trustedCertificates !== undefined) {
    config['trustedCertificates'] = trustedCertificates
      .split(',')
      .map((path) => path.trim())
      .filter((path) => path !== '')
  }

  const level = envValue(environment, 'NEO4J_LOGGING_LEVEL')

  if (level !== undefined) {
    if (isLogLevel(level)) {
      config['logging'] = logging.console(level)
    } else {
      warnIgnoring('NEO4J_LOGGING_LEVEL', `unknown level "${level}"`)
    }
  }

  // shortcut: removed in neo4j-driver 6 — warn + ignore, upgrade if the driver reintroduces them
  for (const setting of ['NEO4J_KNOWN_HOSTS', 'NEO4J_LOAD_BALANCING_STRATEGY']) {
    if (envValue(environment, setting) !== undefined) {
      warnIgnoring(setting, 'removed in neo4j-driver 6')
    }
  }

  const username = envValue(environment, 'NEO4J_USERNAME')
  const password = envValue(environment, 'NEO4J_PASSWORD')

  return {
    uri,
    auth:
      username === undefined || password === undefined ? undefined : auth.basic(username, password),
    config: {
      ...config,
      ...Object.fromEntries(
        Object.entries(driverConfig).filter(([, value]) => value !== undefined),
      ),
    },
    database: envValue(environment, 'NEO4J_DATABASE') ?? 'neo4j',
    enterprise: environment['NEO4J_ENTERPRISE'] === 'true',
  }
}

/**
Load a .env file (dotenv does not clobber variables already set in
process.env), map the NEO4J_* variables to a connection config and
construct the neo4j driver. `driverConfig` — anything neo4j.driver
accepts, e.g. `disableLosslessIntegers: true` — is forwarded verbatim,
merged over the env-derived values.
*/
export function fromEnv(driverConfig: Config = {}): Neode {
  // Load vars from .env — dotenv does not clobber variables that are
  // already set in process.env
  loadDotenv()

  const {
    uri,
    auth: authToken,
    config,
    database,
    enterprise,
  } = configFromEnv(process.env, driverConfig)

  const driver = createDriver(uri, authToken, config)

  return new Neode(new Neo4jConnectionProvider(driver, database), enterprise)
}

/* eslint-enable unicorn/name-replacements -- "Neo4j" is the product name; fromEnv / EnvConnectionConfig are the documented public API names */
