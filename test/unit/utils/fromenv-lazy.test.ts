import { describe, expect, it, vi } from 'vitest'
import neo4j from 'neo4j-driver'

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

// The mock factory THROWS on purpose: vitest evaluates it the moment
// something in the module graph imports 'dotenv'. A static (eager) dotenv
// import anywhere under src/ fails this file; the lazy require inside
// fromEnv() bypasses vitest's module graph and never triggers it.
vi.mock('dotenv', () => {
  throw new Error('neode must not load dotenv eagerly — only fromEnv() may (NTS-599)')
})

describe('lazy dotenv (NTS-599)', () => {
  it('imports the from-env module without loading dotenv', async () => {
    await expect(import('../../../src/from-env')).resolves.toBeTruthy()
  })

  it('still loads dotenv when fromEnv() actually runs (behavior unchanged for .env users)', async () => {
    const { createRequire } = await import('node:module')
    const requireCjs = createRequire(import.meta.url)
    const loaded = () => Object.keys(requireCjs.cache).some((path) => /[/\\]dotenv[/\\]/.test(path))

    const { fromEnv } = await import('../../../src/from-env')
    fromEnv()

    expect(loaded()).toBe(true)
  })
})
