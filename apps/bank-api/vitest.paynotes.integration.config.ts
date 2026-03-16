import { configDefaults, defineConfig } from 'vitest/config';
import {
  payNoteIntegrationTimeoutMs,
  payNoteLiveTests,
  payNoteSerialTests,
  resolvePayNoteIncludes,
} from './vitest.paynotes.integration.shared';

process.env.TZ ??= 'GMT';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: resolvePayNoteIncludes(payNoteLiveTests),
    exclude: [...configDefaults.exclude, ...payNoteSerialTests],
    testTimeout: payNoteIntegrationTimeoutMs,
    hookTimeout: payNoteIntegrationTimeoutMs,
    maxWorkers: 4,
    passWithNoTests: true,
  },
});
