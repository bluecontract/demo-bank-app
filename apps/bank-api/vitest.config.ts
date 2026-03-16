import { defineConfig } from 'vitest/config';

const defaultExclude = ['**/node_modules/**', '**/dist/**'];
const integrationExclude = [
  '**/*.integration.test.ts',
  '**/*.integration.serial.test.ts',
  '**/*.e2e.test.ts',
];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000, // Integration tests may need more time
    hookTimeout: 10000,
    // Exclude integration tests from regular test runs when env var is set
    exclude:
      process.env.VITEST_EXCLUDE_INTEGRATION === 'true'
        ? [...defaultExclude, ...integrationExclude]
        : defaultExclude,
    isolate: true,
    passWithNoTests: true,
  },
});
