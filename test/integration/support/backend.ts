/**
 * Integration test backend.
 *
 * Selects the database backend for integration tests:
 *
 *   OGM_TEST_BACKEND=relate   (default) embedded Relate engine, in-memory,
 *                             zero setup — anything Cypher compatible
 *   OGM_TEST_BACKEND=container Neo4j Testcontainer (NEO4J_IMAGE picks the
 *                             version) — started by test/global-setup.ts
 *   OGM_TEST_BACKEND=neo4j    external Neo4j (Community or Enterprise) via
 *                             NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD
 *   OGM_TEST_BACKEND=memgraph external Memgraph — same env vars
 *
 * Every test file calls `openBackend()` and gets an isolated provider.
 */
import { resolve } from 'path'
import { existsSync } from 'fs'
import { ConnectionProvider } from '../../../src/driver/types'
import { Neo4jConnectionProvider } from '../../../src/driver/neo4j-connection-provider.js'
import { RelateConnectionProvider, requireRelateClient } from '../../../src/driver/relate'
import { Neode } from '../../../src/neode.service'

export interface BackendCapabilities {
  /** Server edition as reported by the backend */
  edition: 'enterprise' | 'community' | 'unknown'
  /** Unique/existence constraints and indexes */
  constraints: boolean
  /** Composite (multi-property) unique constraints and indexes */
  compositeConstraints: boolean
  /** Property-type constraints (`REQUIRE n.prop IS :: STRING`) */
  propertyTypes: boolean
  /** Temporal types (date, datetime, …) */
  temporals: boolean
  /** Point type */
  points: boolean
  /** Multiple databases */
  multiDatabase: boolean
  /** Full-text indexes and search, working end-to-end */
  fulltext: boolean
  /** Vector indexes and kNN search, working end-to-end */
  vector: boolean
}

export interface TestBackend {
  name: string
  neode: Neode
  connection: ConnectionProvider
  capabilities: BackendCapabilities
  clearGraph(): Promise<void>
  close(): Promise<void>
}

export const isEnterprise = (capabilities: BackendCapabilities): boolean =>
  capabilities.edition === 'enterprise'

async function probeCapabilities(connection: ConnectionProvider): Promise<BackendCapabilities> {
  // Constraints: try to create and drop a scratch constraint
  let constraints = false

  try {
    await connection.run(
      'CREATE CONSTRAINT __ogm_probe__ IF NOT EXISTS FOR (n:__OgmProbe__) REQUIRE n.__probe__ IS UNIQUE',
    )
    await connection.run('DROP CONSTRAINT __ogm_probe__ IF EXISTS')
    constraints = true
  } catch {
    constraints = false
  }

  // Composite unique constraints: the parenthesised property list is the
  // only spelling some engines parse, so probe exactly that syntax — and
  // require end-to-end enforcement, not just DDL acceptance (Relate
  // accepts the constraint but does not enforce it)
  let compositeConstraints = false

  try {
    await connection.run(
      'CREATE CONSTRAINT __ogm_comp_probe__ IF NOT EXISTS FOR (n:__OgmProbe__) REQUIRE (n.__p1__, n.__p2__) IS UNIQUE',
    )

    let enforced = true

    try {
      await connection.run("CREATE (:__OgmProbe__ { __p1__: 'x', __p2__: 'y' })")
      await connection.run("CREATE (:__OgmProbe__ { __p1__: 'x', __p2__: 'y' })")
      enforced = false
    } catch {
      enforced = true
    }

    await connection.run('MATCH (n:__OgmProbe__) DETACH DELETE n')
    await connection.run('DROP CONSTRAINT __ogm_comp_probe__ IF EXISTS')

    compositeConstraints = enforced
  } catch {
    compositeConstraints = false
  }

  // Property-type constraints (`IS :: TYPE`, Neo4j 5.7+)
  let propertyTypes = false

  try {
    await connection.run(
      'CREATE CONSTRAINT __ogm_pt_probe__ IF NOT EXISTS FOR (n:__OgmProbe__) REQUIRE n.__probe__ IS :: STRING',
    )
    await connection.run('DROP CONSTRAINT __ogm_pt_probe__ IF EXISTS')
    propertyTypes = true
  } catch {
    propertyTypes = false
  }

  // Temporals
  let temporals = false

  try {
    const result = await connection.run('RETURN date() AS d')
    temporals = result.records[0].get('d') !== undefined
  } catch {
    temporals = false
  }

  // Points
  let points = false

  try {
    const result = await connection.run('RETURN point({ x: 1, y: 2 }) AS p')
    points = result.records[0].get('p') !== undefined
  } catch {
    points = false
  }

  // Multi-database support
  let multiDatabase = false

  try {
    await connection.run('SHOW DATABASES')
    multiDatabase = true
  } catch {
    multiDatabase = false
  }

  // Full-text search: some engines accept the DDL but don't index, so
  // probe the whole cycle and require the search to return a row
  let fulltext = false

  try {
    await connection.run(
      'CREATE FULLTEXT INDEX __ogm_ft_probe__ IF NOT EXISTS FOR (n:__OgmFulltextProbe__) ON EACH [n.__probe__]',
    )
    await connection.run("CREATE (n:__OgmFulltextProbe__ { __probe__: 'probe' })")

    const result = await connection.run(
      "CALL db.index.fulltext.queryNodes('__ogm_ft_probe__', 'probe') YIELD node, score RETURN node, score",
    )
    fulltext = result.records.length > 0
  } catch {
    fulltext = false
  }

  // Vector search: same end-to-end probe, requiring a scored row back
  let vector = false

  try {
    await connection.run(
      'CREATE VECTOR INDEX __ogm_vec_probe__ IF NOT EXISTS FOR (n:__OgmVectorProbe__) ON (n.__probe__) ' +
        "OPTIONS { indexConfig: { `vector.dimensions`: 2, `vector.similarity_function`: 'cosine' } }",
    )
    await connection.run('CREATE (n:__OgmVectorProbe__ { __probe__: [0.1, 0.2] })')

    const result = await connection.run(
      "CALL db.index.vector.queryNodes('__ogm_vec_probe__', 1, [0.1, 0.2]) YIELD node, score RETURN node, score",
    )
    vector = result.records.length > 0
  } catch {
    vector = false
  }

  // Clean up what the backend lets us (dropping fulltext/vector indexes is
  // not supported everywhere; the leftover scratch objects are inert)
  for (const cleanup of [
    'MATCH (n:__OgmFulltextProbe__) DETACH DELETE n',
    'DROP FULLTEXT INDEX __ogm_ft_probe__ IF EXISTS',
    'MATCH (n:__OgmVectorProbe__) DETACH DELETE n',
    'DROP VECTOR INDEX __ogm_vec_probe__ IF EXISTS',
  ]) {
    try {
      await connection.run(cleanup)
    } catch {
      // ignore
    }
  }

  return {
    edition: await connection.edition(),
    constraints,
    compositeConstraints,
    propertyTypes,
    temporals,
    points,
    multiDatabase,
    fulltext,
    vector,
  }
}

async function openRelateBackend(): Promise<TestBackend> {
  // Resolve the native library before the client loads
  if (!process.env.RELATE_LIB) {
    for (const profile of ['release', 'debug']) {
      const candidate = resolve(
        __dirname,
        `../../../../relate/target/${profile}/librelate_ffi.dylib`,
      )

      if (existsSync(candidate)) {
        process.env.RELATE_LIB = candidate
        break
      }
    }
  }

  // Touch the client so the native library loads before we open a database
  requireRelateClient()

  const client = requireRelateClient()
  const database = client.Database.open(':memory:')

  const connection = new RelateConnectionProvider(database)

  const neode = new Neode(connection)

  return {
    name: 'relate',
    neode,
    connection,
    capabilities: await probeCapabilities(connection),
    async clearGraph() {
      await connection.run('MATCH (n) DETACH DELETE n')
    },
    async close() {
      // In-memory: nothing to persist
    },
  }
}

async function openBoltBackend(name: string, config?: BoltBackendConfig): Promise<TestBackend> {
  const neo4j = require('neo4j-driver')

  const uri =
    config?.uri ??
    (process.env.NEO4J_URI ||
      `${process.env.NEO4J_PROTOCOL || 'bolt'}://${process.env.NEO4J_HOST || 'localhost'}:${process.env.NEO4J_PORT || '7687'}`)
  const username = config?.username ?? process.env.NEO4J_USERNAME
  const password = config?.password ?? process.env.NEO4J_PASSWORD

  if (!username || !password) {
    throw new Error(
      `OGM_TEST_BACKEND=${name} requires NEO4J_USERNAME and NEO4J_PASSWORD ` +
        `(and optionally NEO4J_URI or NEO4J_PROTOCOL/NEO4J_HOST/NEO4J_PORT, NEO4J_DATABASE)`,
    )
  }

  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password))

  // Fail fast if the server is unreachable
  await driver.getServerInfo()

  const database = config?.database ?? (process.env.NEO4J_DATABASE || 'neo4j')
  const connection = new Neo4jConnectionProvider(driver, database)
  const neode = new Neode(connection)

  return {
    name,
    neode,
    connection,
    capabilities: await probeCapabilities(connection),
    async clearGraph() {
      await connection.run('MATCH (n) DETACH DELETE n')
    },
    async close() {
      await driver.close()
    },
  }
}

/**
 * Explicit backend config for callers that hold their connection values in
 * code (e.g. the Aura smoke — its provisioned credentials must never be
 * staged through the environment). Omitted fields fall back to the env vars.
 */
export interface BoltBackendConfig {
  uri: string
  username: string
  password: string
  database: string
}

export async function openBackend(config?: BoltBackendConfig): Promise<TestBackend> {
  const backend = process.env.OGM_TEST_BACKEND || 'relate'

  switch (backend) {
    case 'relate':
      return openRelateBackend()

    case 'neo4j':
    case 'container':
    case 'memgraph':
      return openBoltBackend(backend, config)

    default:
      throw new Error(
        `Unknown OGM_TEST_BACKEND "${backend}". Supported: relate (default), neo4j, container, memgraph`,
      )
  }
}
