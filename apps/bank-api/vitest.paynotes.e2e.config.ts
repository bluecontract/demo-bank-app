import { defineConfig } from 'vitest/config';

const payNoteRealMyOsCiOptInEnvVar = 'CI_PAYNOTES_E2E_ENABLED';

const resolveRealMyOsCanaryIncludes = (patterns: string[]) =>
  process.env.CI === 'true' &&
  process.env[payNoteRealMyOsCiOptInEnvVar] !== '1'
    ? []
    : patterns;

process.env.TZ ??= 'GMT';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: resolveRealMyOsCanaryIncludes([
      'tests/paynotes/e2e/**/*.e2e.test.ts',
    ]),
    setupFiles: ['tests/paynotes/setup/loadAgentEnv.setup.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    passWithNoTests: true,
  },
});
