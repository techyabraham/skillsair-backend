import { defineConfig } from 'vitest/config'

/**
 * Vitest runs the *.spec.ts files. The older node:test files (*.test.ts) keep running through
 * `npm run test:legacy`; `npm test` runs both.
 *
 * Integration specs need TEST_DATABASE_URI (a disposable local Postgres) and skip without it.
 * They share one database, so files run one at a time.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
})
