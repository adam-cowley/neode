/**
 * Integration test setup — runs before each test file.
 *
 * The backend is selected via OGM_TEST_BACKEND (see support/backend.ts):
 *   - "relate"  (default) embedded in-memory Cypher engine — zero setup
 *   - "neo4j"   external Neo4j Community/Enterprise via NEO4J_* env vars
 *   - "memgraph" external Memgraph via NEO4J_* env vars
 *
 * Timeouts are configured in vitest.config.ts.
 */
export {}
