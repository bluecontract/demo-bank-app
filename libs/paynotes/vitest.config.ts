import { defineConfig } from 'vitest/config';

const isCi = process.env.CI === 'true';
const timeoutMs = isCi ? 30000 : 10000;

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: timeoutMs,
    hookTimeout: timeoutMs,
    ...(isCi
      ? {
          pool: 'threads',
          fileParallelism: false,
          maxWorkers: 1,
          minWorkers: 1,
          reporters: ['dot'],
          poolOptions: {
            threads: {
              singleThread: true,
            },
          },
        }
      : {}),
    exclude:
      process.env.VITEST_EXCLUDE_INTEGRATION === 'true'
        ? ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts']
        : ['**/node_modules/**', '**/dist/**'],
    isolate: true,
    passWithNoTests: true,
  },
});
