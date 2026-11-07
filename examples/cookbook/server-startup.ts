/**
Cookbook — server startup: verify the database before booting the app.

The startup sequence every service in front of Neo4j wants:
1. waitUntilReachable() — retry a throwaway-driver check until the
   database answers (or fail fast with ConnectivityTimeoutError),
2. fromEnv() — build the OGM from the NEO4J_* environment variables,
3. installSchema() — constraints and indexes before the first request,
then hand the instance to the HTTP handlers and close it on shutdown.

Run:  NEO4J_URI=bolt://localhost:7687 NEO4J_USERNAME=neo4j NEO4J_PASSWORD=*** \
      npx tsx examples/cookbook/server-startup.ts
*/
import { createServer } from 'node:http'
import { fromEnv, waitUntilReachable } from 'neode'

async function main(): Promise<void> {
  // 1. Fail fast when the database is down — with a bounded budget
  await waitUntilReachable(
    { uri: process.env['NEO4J_URI'] ?? 'bolt://localhost:7687' },
    { timeout: 15_000 },
  )

  // 2. The OGM for the rest of the process
  const neode = fromEnv()

  // 3. Schema before traffic
  await neode.installSchema()

  const server = createServer(async (_request, response) => {
    const output = await neode.cypher('MATCH (n) RETURN count(n) AS nodes')
    response.end(`nodes: ${String(output.records[0]?.get('nodes'))}`)
  })

  server.listen(3000, () => {
    console.log('listening on :3000')
  })

  // Shut down cleanly — close the OGM's connections with the server
  const shutdown = (): void => {
    server.close()
    void neode.close().then(() => {
      process.exit(0)
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(console.error)
