import { configDefaults, defineConfig } from 'vitest/config';
import {
  payNoteIntegrationTimeoutMs,
  payNoteSerialTests,
} from './vitest.paynotes.integration.shared';

process.env.TZ ??= 'GMT';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/paynotes/live/scenarios/**/*.integration.test.ts'],
    exclude: [...configDefaults.exclude, ...payNoteSerialTests],
    testTimeout: payNoteIntegrationTimeoutMs,
    hookTimeout: payNoteIntegrationTimeoutMs,
    maxWorkers: 4,
  },
});
