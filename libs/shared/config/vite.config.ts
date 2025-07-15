import { defineConfig } from 'vite';

export default defineConfig(() => ({
  cacheDir: '../../../node_modules/.vite/libs/shared/config',
  plugins: [],
  test: {
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
    isolate: true,
    passWithNoTests: true,
  },
}));
