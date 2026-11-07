import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // Test files must not run in parallel against one shared server: the
    // container backend points every file at the same Neo4j database, and
    // one file's wipe() would delete another file's data mid-test. The
    // embedded backend is unaffected either way (each file opens its own
    // in-memory database), so parallelism stays on for every other run.
    fileParallelism: process.env.OGM_TEST_BACKEND === 'container' ? false : undefined,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
      reporter: ['text', 'html', 'lcov'],
      // Baseline (unit suite, Nov 2026): ~73.1% lines, ~76.6% functions,
      // ~85.3% branches — the embedded backend's native library is not
      // available in CI, so CI coverage measures the unit project only
      // and the thresholds ratchet just below its actual. The full suite
      // (unit + integration) reaches ~89.9% lines / ~92.0% functions.
      thresholds: {
        lines: 73,
        functions: 76,
        branches: 85,
        statements: 73,
      },
    },
    projects: [
      // Fast tests with no database dependency
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          globals: true,
        },
      },

      // Built-output tests: import dist/ (ESM + CJS) — run after `build`
      {
        test: {
          name: 'package',
          include: ['test/package/**/*.test.ts'],
          globals: true,
        },
      },

      // Type-level tests (expectTypeOf) — no runtime assertions
      {
        typecheck: {
          enabled: true,
          include: ['test/types/**/*.test-d.ts'],
        },
        test: {
          name: 'types',
          include: ['test/types/**/*.test-d.ts'],
          globals: true,
        },
      },

      // Tests against a real graph database:
      // Relate (embedded, default) or Neo4j / Memgraph via Bolt (env vars).
      // OGM_TEST_BACKEND=container starts a Neo4j Testcontainer for the run
      // (NEO4J_IMAGE picks the version). Files share one in-process engine,
      // so they must not race each other's schema installs (wipe() drops
      // every constraint).
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          setupFiles: ['./test/integration/setup.ts'],
          globalSetup: ['./test/global-setup.ts'],
          testTimeout: 30000,
          fileParallelism: false,
          globals: true,
        },
      },
    ],
  },
})
