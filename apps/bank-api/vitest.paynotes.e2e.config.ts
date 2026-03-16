import { defineConfig } from 'vitest/config';
import { resolvePayNoteIncludes } from './vitest.paynotes.integration.shared';

process.env.TZ ??= 'GMT';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: resolvePayNoteIncludes(['tests/paynotes/e2e/**/*.e2e.test.ts']),
    setupFiles: ['tests/paynotes/setup/loadAgentEnv.setup.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    passWithNoTests: true,
  },
});
