import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000,
    hookTimeout: 10000,
    exclude: ['**/node_modules/**', '**/dist/**'],
    isolate: true,
    passWithNoTests: true,
  },
});
