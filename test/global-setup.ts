/**
 * Integration-suite global setup.
 *
 * Selected via OGM_TEST_BACKEND:
 *   - "relate"    (default) embedded engine — this setup is a no-op
 *   - "neo4j"     external server — no-op here, configured via NEO4J_* vars
 *   - "container" start a throwaway Neo4j Testcontainer for the whole run
 *     (NEO4J_IMAGE controls the version, e.g. neo4j:5-community) and point
 *     the standard NEO4J_* vars at it. CI uses this to test against real
 *     Neo4j versions without external services.
 */
import { Neo4jContainer } from '@testcontainers/neo4j'
import type { StartedNeo4jContainer } from '@testcontainers/neo4j'

let container: StartedNeo4jContainer | undefined

export default async function (): Promise<() => Promise<void>> {
  if (process.env.OGM_TEST_BACKEND !== 'container') {
    return async () => {}
  }

  const image = process.env.NEO4J_IMAGE || 'neo4j:5-community'
  const password = process.env.NEO4J_PASSWORD || 'ogm-test-password'

  container = await new Neo4jContainer(image).withPassword(password).start()

  process.env.NEO4J_URI = container.getBoltUri()
  process.env.NEO4J_USERNAME = 'neo4j'
  process.env.NEO4J_PASSWORD = password

  return async () => {
    await container?.stop()
    container = undefined
  }
}
