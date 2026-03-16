export const payNoteIntegrationTimeoutMs = 90_000;

export const payNoteLiveTests = [
  'tests/paynotes/live/**/*.integration.test.ts',
];

export const payNoteSerialTests = [
  'tests/paynotes/live/**/*.integration.serial.test.ts',
];

export const payNoteCiOptInEnvVar = 'CI_PAYNOTES_ENABLED';

export const shouldRunPayNoteSuitesInCurrentEnv = () =>
  process.env.CI !== 'true' || process.env[payNoteCiOptInEnvVar] === '1';

export const resolvePayNoteIncludes = (patterns: string[]) =>
  shouldRunPayNoteSuitesInCurrentEnv() ? patterns : [];
