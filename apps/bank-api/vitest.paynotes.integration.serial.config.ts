import { defineConfig } from 'vitest/config';
import {
  payNoteIntegrationTimeoutMs,
  payNoteSerialTests,
  resolvePayNoteIncludes,
} from './vitest.paynotes.integration.shared';

process.env.TZ ??= 'GMT';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: resolvePayNoteIncludes(payNoteSerialTests),
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: payNoteIntegrationTimeoutMs,
    hookTimeout: payNoteIntegrationTimeoutMs,
    passWithNoTests: true,
  },
});
