import { describe, it } from 'vitest';

const enabled = process.env.MYOS_E2E_ENABLED === '1';

/**
 * Keep this suite intentionally small.
 * Prefer pull-and-post or queue-backed delivery over direct webhook delivery to
 * ephemeral runners.
 */
describe.skipIf(!enabled)('PayNote real MyOS canaries', () => {
  it.skip('card delivery happy path', async () => {
    // Blocked until the local/live bootstrap continuation is aligned well
    // enough to promote the same flow into the real-MyOS canary suite.
  });

  it.skip('subscription one follow-up cycle', async () => {
    // Blocked until the mandate bootstrap + follow-up-cycle flow is stabilized
    // in the local serial suite and promoted to a canary.
  });

  it.skip('voucher cashback smoke', async () => {
    // Blocked until voucher monitoring and cashback continuation flows are
    // modeled and validated in local serial scenarios.
  });

  it.skip('fetch-by-id compatibility smoke', async () => {
    // Keep this tiny and separate from the main full-payload live/E2E path.
  });
});
