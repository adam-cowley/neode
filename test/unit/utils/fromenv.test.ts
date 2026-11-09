import { afterEach, describe, expect, it, vi } from 'vitest'
import neo4j from 'neo4j-driver'

import { configFromEnv, fromEnv } from '../../../src/from-env'
import { Neode } from '../../../src/neode.service'

vi.mock('neo4j-driver', () => {
  const driver = vi.fn(() => ({ mocked: 'driver' }))
  const auth = {
    basic: vi.fn(
      (username: string, password: string) =>
        ({
          scheme: 'basic',
          principal: username,
          credentials: password,
        }) as const,
    ),
  }
  const logging = {
    console: vi.fn((level: string) => ({ level, logger: vi.fn() })),
  }
  return { default: { driver, auth, logging }, driver, auth, logging }
})

const NEO4J_VARS = [
  'NEO4J_PROTOCOL',
  'NEO4J_HOST',
  'NEO4J_PORT',
  'NEO4J_URI',
  'NEO4J_USERNAME',
  'NEO4J_PASSWORD',
  'NEO4J_ENTERPRISE',
  'NEO4J_DATABASE',
  'NEO4J_ENCRYPTION',
  'NEO4J_ENCRYPTED',
  'NEO4J_TRUST',
  'NEO4J_TRUSTED_CERTIFICATES',
  'NEO4J_KNOWN_HOSTS',
  'NEO4J_MAX_CONNECTION_POOLSIZE',
  'NEO4J_MAX_TRANSACTION_RETRY_TIME',
  'NEO4J_LOAD_BALANCING_STRATEGY',
  'NEO4J_MAX_CONNECTION_LIFETIME',
  'NEO4J_CONNECTION_TIMEOUT',
  'NEO4J_CONNECTION_ACQUISITION_TIMEOUT',
  'NEO4J_DISABLE_LOSSLESS_INTEGERS',
  'NEO4J_LOGGING_LEVEL',
]

afterEach(() => {
  NEO4J_VARS.forEach((name) => delete process.env[name])
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('configFromEnv', () => {
  it('falls back to sensible defaults when no vars are set', () => {
    expect(configFromEnv({})).toEqual({
      uri: 'bolt://localhost:7687',
      auth: undefined,
      config: {},
      database: 'neo4j',
      enterprise: false,
    })
  })

  it('composes the uri from NEO4J_PROTOCOL / NEO4J_HOST / NEO4J_PORT', () => {
    const env = configFromEnv({
      NEO4J_PROTOCOL: 'neo4j',
      NEO4J_HOST: 'db.example.com',
      NEO4J_PORT: '7688',
    })

    expect(env.uri).toEqual('neo4j://db.example.com:7688')
  })

  it('prefers NEO4J_URI over the composed connection string', () => {
    const env = configFromEnv({
      NEO4J_URI: 'neo4j+s://cloud.neo4j.io:7687',
      NEO4J_HOST: 'ignored.example.com',
    })

    expect(env.uri).toEqual('neo4j+s://cloud.neo4j.io:7687')
  })

  it('builds basic auth when NEO4J_USERNAME and NEO4J_PASSWORD are set', () => {
    const env = configFromEnv({
      NEO4J_USERNAME: 'user',
      NEO4J_PASSWORD: 'pass',
    })

    expect(env.auth).toEqual({
      scheme: 'basic',
      principal: 'user',
      credentials: 'pass',
    })
  })

  it('omits auth when only one of username / password is set', () => {
    expect(configFromEnv({ NEO4J_USERNAME: 'user' }).auth).toBeUndefined()
    expect(configFromEnv({ NEO4J_PASSWORD: 'pass' }).auth).toBeUndefined()
  })

  it('maps NEO4J_ENTERPRISE=true', () => {
    expect(configFromEnv({ NEO4J_ENTERPRISE: 'true' }).enterprise).toBe(true)
    expect(configFromEnv({ NEO4J_ENTERPRISE: 'false' }).enterprise).toBe(false)
  })

  it('maps NEO4J_DATABASE', () => {
    expect(configFromEnv({ NEO4J_DATABASE: 'customers' }).database).toEqual('customers')
  })

  it('parses the integer config settings as numbers', () => {
    const env = configFromEnv({
      NEO4J_MAX_CONNECTION_POOLSIZE: '50',
      NEO4J_MAX_TRANSACTION_RETRY_TIME: '5000',
      NEO4J_MAX_CONNECTION_LIFETIME: '36000',
      NEO4J_CONNECTION_TIMEOUT: '30000',
      NEO4J_CONNECTION_ACQUISITION_TIMEOUT: '60000',
    })

    expect(env.config).toEqual({
      maxConnectionPoolSize: 50,
      maxTransactionRetryTime: 5000,
      maxConnectionLifetime: 36000,
      connectionTimeout: 30000,
      connectionAcquisitionTimeout: 60000,
    })
  })

  it('maps NEO4J_DISABLE_LOSSLESS_INTEGERS as a boolean', () => {
    expect(
      configFromEnv({ NEO4J_DISABLE_LOSSLESS_INTEGERS: 'true' }).config.disableLosslessIntegers,
    ).toBe(true)
    expect(
      configFromEnv({ NEO4J_DISABLE_LOSSLESS_INTEGERS: 'false' }).config.disableLosslessIntegers,
    ).toBe(false)
  })

  describe('NEO4J_ENCRYPTION', () => {
    it('maps true / ENCRYPTION_ON and false / ENCRYPTION_OFF to booleans', () => {
      expect(configFromEnv({ NEO4J_ENCRYPTION: 'true' }).config.encrypted).toBe(true)
      expect(configFromEnv({ NEO4J_ENCRYPTION: 'ENCRYPTION_ON' }).config.encrypted).toBe(true)
      expect(configFromEnv({ NEO4J_ENCRYPTION: 'false' }).config.encrypted).toBe(false)
      expect(configFromEnv({ NEO4J_ENCRYPTION: 'ENCRYPTION_OFF' }).config.encrypted).toBe(false)
    })

    it('warns and ignores unknown values', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      expect(configFromEnv({ NEO4J_ENCRYPTION: 'maybe' }).config.encrypted).toBeUndefined()
      expect(warn).toHaveBeenCalled()
    })
  })

  it('maps NEO4J_TRUST', () => {
    expect(
      configFromEnv({ NEO4J_TRUST: 'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES' }).config.trust,
    ).toEqual('TRUST_SYSTEM_CA_SIGNED_CERTIFICATES')
  })

  it('warns on legacy trust strategies dropped in driver 6 but still passes them through', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(configFromEnv({ NEO4J_TRUST: 'TRUST_SIGNED_CERTIFICATES' }).config.trust).toEqual(
      'TRUST_SIGNED_CERTIFICATES',
    )
    expect(warn).toHaveBeenCalled()
  })

  it('trims NEO4J_TRUSTED_CERTIFICATES entries and drops empty ones', () => {
    const { config } = configFromEnv({ NEO4J_TRUSTED_CERTIFICATES: ' /a.pem , /b.pem,, ' })

    expect(config['trustedCertificates']).toEqual(['/a.pem', '/b.pem'])
  })

  it('ignores non-finite numeric settings with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { config } = configFromEnv({
      NEO4J_MAX_CONNECTION_POOLSIZE: 'abc',
      NEO4J_CONNECTION_TIMEOUT: 'Infinity',
      NEO4J_MAX_CONNECTION_LIFETIME: '5000',
    })

    expect(config).toEqual({ maxConnectionLifetime: 5000 })
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('comma-splits NEO4J_TRUSTED_CERTIFICATES', () => {
    const env = configFromEnv({
      NEO4J_TRUSTED_CERTIFICATES: '/a.pem,/b.pem,/c.pem',
    })

    expect(env.config.trustedCertificates).toEqual(['/a.pem', '/b.pem', '/c.pem'])
  })

  it('maps NEO4J_LOGGING_LEVEL to a driver 6 logging config object', () => {
    const env = configFromEnv({ NEO4J_LOGGING_LEVEL: 'debug' })
    const logging = env.config.logging as { level: string; logger: unknown }

    expect(logging.level).toEqual('debug')
    expect(typeof logging.logger).toEqual('function')
  })

  it('warns and ignores unknown logging levels', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env = configFromEnv({ NEO4J_LOGGING_LEVEL: 'verbose' })

    expect(env.config.logging).toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('warns and ignores config keys removed in driver 6', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env = configFromEnv({
      NEO4J_KNOWN_HOSTS: '127.0.0.1',
      NEO4J_LOAD_BALANCING_STRATEGY: 'least_connected',
    })

    expect(env.config).toEqual({})
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('merges extra driver config over the env-derived config', () => {
    const env = configFromEnv(
      { NEO4J_MAX_CONNECTION_POOLSIZE: '11' },
      { maxConnectionPoolSize: 99, disableLosslessIntegers: true },
    )

    expect(env.config).toEqual({ maxConnectionPoolSize: 99, disableLosslessIntegers: true })
  })

  it('skips undefined entries in the extra config so env-derived values survive', () => {
    const env = configFromEnv(
      { NEO4J_MAX_CONNECTION_POOLSIZE: '11' },
      { maxConnectionPoolSize: undefined },
    )

    expect(env.config).toEqual({ maxConnectionPoolSize: 11 })
  })

  it('treats an empty extra config as no overrides', () => {
    expect(configFromEnv({}, {}).config).toEqual({})
  })
})

describe('fromEnv', () => {
  it('builds the neo4j driver and Neode instance from process.env', () => {
    process.env.NEO4J_URI = 'neo4j://env-host:7688'
    process.env.NEO4J_USERNAME = 'env-user'
    process.env.NEO4J_PASSWORD = 'env-pass'
    process.env.NEO4J_DATABASE = 'env-db'
    process.env.NEO4J_ENTERPRISE = 'true'
    process.env.NEO4J_MAX_CONNECTION_POOLSIZE = '11'

    const neode = fromEnv()

    expect(neo4j.driver).toHaveBeenCalledWith(
      'neo4j://env-host:7688',
      { scheme: 'basic', principal: 'env-user', credentials: 'env-pass' },
      { maxConnectionPoolSize: 11 },
    )
    expect(neode).toBeInstanceOf(Neode)
    expect(neode.isEnterprise()).toBe(true)

    const connection = neode.getConnection() as unknown as {
      database?: string
    }
    expect(connection.database).toEqual('env-db')
  })

  it('passes arbitrary driver config through to the neo4j driver constructor', () => {
    process.env.NEO4J_URI = 'neo4j://env-host:7688'

    fromEnv({ disableLosslessIntegers: true, connectionTimeout: 1234 })

    expect(neo4j.driver).toHaveBeenCalledWith('neo4j://env-host:7688', undefined, {
      disableLosslessIntegers: true,
      connectionTimeout: 1234,
    })
  })

  it('lets explicit driver config win over env-derived values', () => {
    process.env.NEO4J_MAX_CONNECTION_POOLSIZE = '11'

    fromEnv({ maxConnectionPoolSize: 99 })

    expect(neo4j.driver).toHaveBeenCalledWith(expect.any(String), undefined, {
      maxConnectionPoolSize: 99,
    })
  })

  it('keeps env-derived config the explicit driver config does not set', () => {
    process.env.NEO4J_MAX_CONNECTION_POOLSIZE = '11'

    fromEnv({ disableLosslessIntegers: true })

    expect(neo4j.driver).toHaveBeenCalledWith(expect.any(String), undefined, {
      maxConnectionPoolSize: 11,
      disableLosslessIntegers: true,
    })
  })
})
