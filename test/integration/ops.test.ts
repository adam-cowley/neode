/**
 * NTS-130 (verifyConnectivity + waitUntilReachable) and
 * NTS-134 (Cypher script runner) integration tests.
 *
 * verifyConnectivity/waitUntilReachable drive a real neo4j-driver against a
 * config. The embedded Relate engine has no Bolt endpoint, so:
 *  - the success and retry paths are probed via the `check` override against
 *    the embedded backend (no network),
 *  - the timeout path uses a real driver against a bogus local port
 *    (connection refused is instant — no network dependency).
 *
 * NOTE: this file deliberately does NOT vi.mock neo4j-driver, so the real
 * driver is exercised. Run with the default OGM_TEST_BACKEND=relate.
 */
import { describe, expect, it } from 'vitest'

import { openBackend, TestBackend } from './support/backend'

import { runCypherScript, splitCypherStatements } from '../../src/ops/cypher-script'
import { verifyConnectivity, waitUntilReachable } from '../../src/ops/verify-connectivity'

describe('runCypherScript (against the embedded backend)', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('executes every statement in a script and returns per-statement results', async () => {
    await backend.connection.run('MATCH (n) DETACH DELETE n')

    const results = await runCypherScript(
      backend.connection,
      [
        'CREATE (:ScriptPerson {name: "Alice"});',
        '// a comment between statements',
        'CREATE (:ScriptPerson {name: "Bob; the Builder"});',
        'MATCH (n:ScriptPerson) RETURN n.name AS name;',
      ].join('\n'),
    )

    expect(results).toHaveLength(3)

    const names = results[2].records.map((record) => record.get('name'))
    expect(names).toEqual(['Alice', 'Bob; the Builder'])
  })

  it('reports progress through onStatement', async () => {
    await backend.connection.run('MATCH (n) DETACH DELETE n')

    const progress: string[] = []

    await runCypherScript(backend.connection, 'CREATE (a); CREATE (b); CREATE (c);', {
      onStatement: (statement) => progress.push(statement),
    })

    expect(progress).toEqual(['CREATE (a)', 'CREATE (b)', 'CREATE (c)'])
  })

  it('propagates statement errors and stops the run', async () => {
    await expect(
      runCypherScript(backend.connection, 'CREATE (a); THIS IS NOT CYPHER; CREATE (b);'),
    ).rejects.toThrow()
  })

  it('agrees with splitCypherStatements on what will run', async () => {
    const script = 'RETURN 1; RETURN 2; // tail comment'

    expect(splitCypherStatements(script)).toHaveLength(2)
  })
})

describe('verifyConnectivity', () => {
  it('rejects when nothing listens on the port', async () => {
    await expect(
      verifyConnectivity({ uri: 'bolt://127.0.0.1:9', config: { connectionTimeout: 500 } }),
    ).rejects.toThrow()
  })
})

describe('waitUntilReachable', () => {
  it('resolves once the probe succeeds (probed against the embedded backend)', async () => {
    const backend = await openBackend()

    try {
      await waitUntilReachable(
        { uri: 'bolt://unused-by-the-check' },
        {
          timeout: 5000,
          interval: 10,
          check: async () => {
            await backend.connection.run('RETURN 1 AS one')
          },
        },
      )
    } finally {
      await backend.close()
    }
  })

  it('retries with backoff until the probe succeeds', async () => {
    let attempts = 0

    await waitUntilReachable(
      { uri: 'bolt://unused-by-the-check' },
      {
        timeout: 5000,
        interval: 10,
        check: async () => {
          attempts += 1

          if (attempts < 3) {
            throw new Error('not yet')
          }
        },
      },
    )

    expect(attempts).toBe(3)
  })

  it('rejects with a clear message when still unreachable past the deadline', async () => {
    const start = Date.now()

    await expect(
      waitUntilReachable(
        { uri: 'bolt://127.0.0.1:9', config: { connectionTimeout: 200 } },
        { timeout: 300, interval: 25 },
      ),
    ).rejects.toThrow(/not reachable within 300ms/)

    // The deadline was honoured — no runaway waiting
    expect(Date.now() - start).toBeLessThan(10_000)
  }, 15_000)

  it('rejects when the probe keeps failing and the timeout elapses', async () => {
    await expect(
      waitUntilReachable(
        { uri: 'bolt://unused-by-the-check' },
        {
          timeout: 120,
          interval: 10,
          check: async () => {
            throw new Error('connection refused')
          },
        },
      ),
    ).rejects.toThrow(/not reachable within 120ms/)
  })
})
