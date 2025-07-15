import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000, // Integration tests may need more time
    hookTimeout: 10000,
    // Exclude integration tests from regular test runs when env var is set
    exclude:
      process.env.VITEST_EXCLUDE_INTEGRATION === 'true'
        ? ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts']
        : ['**/node_modules/**', '**/dist/**'],
    isolate: true,
    passWithNoTests: true,
  },
});
