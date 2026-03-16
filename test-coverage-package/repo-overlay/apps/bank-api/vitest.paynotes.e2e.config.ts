import { defineConfig } from 'vitest/config';

process.env.TZ ??= 'GMT';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/paynotes/e2e/**/*.e2e.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
