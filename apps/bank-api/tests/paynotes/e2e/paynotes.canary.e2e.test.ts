import { describe, it } from 'vitest';

const enabled = process.env.MYOS_E2E_ENABLED === '1';

/**
 * Keep this suite intentionally small.
 * Prefer pull-and-post or queue-backed delivery over direct webhook delivery to
 * ephemeral runners.
 */
describe.skipIf(!enabled)('PayNote real MyOS canaries', () => {
  it.skip('card delivery happy path', async () => {
    // Local card-delivery now passes. This canary remains blocked until the
    // real-MyOS pull-and-post canary path is implemented instead of the current
    // placeholder.
  });

  it.skip('subscription one follow-up cycle', async () => {
    // Blocked until the local serial suite can materialize the mandate
    // bootstrap target session and one linked follow-up charge cycle.
  });

  it.skip('voucher cashback smoke', async () => {
    // Blocked until local serial coverage can reproduce the monitoring report
    // and linked voucher cashback continuation chain.
  });

  it.skip('fetch-by-id compatibility smoke', async () => {
    // Keep this tiny and separate from the main full-payload live/E2E path.
    // Promote it once the real-MyOS canary runner is wired.
  });
});
