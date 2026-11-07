import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
      reporter: ['text', 'html', 'lcov'],
      // Baseline (full suite, Nov 2026): ~89% lines, ~86% branches,
      // ~93% functions — thresholds ratchet just below actual; the
      // plan's 90/90/85 is the target as coverage grows
      thresholds: {
        lines: 89,
        functions: 92,
        branches: 86,
        statements: 89,
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
