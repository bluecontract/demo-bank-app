import { describe, it } from 'vitest';

const enabled = process.env.MYOS_E2E_ENABLED === '1';

/**
 * Intentionally tiny suite.
 * Prefer queue-backed or pull-and-post delivery over direct webhook to ephemeral runners.
 */
describe.skipIf(!enabled)('PayNote real MyOS canaries', () => {
  it('card delivery happy path', async () => {
    // TODO(agent):
    // 1. create customer + funded card setup,
    // 2. create / deliver paynote in real MyOS,
    // 3. consume event via pull-and-post,
    // 4. accept delivery,
    // 5. assert single capture and no duplicate on replay.
  });

  it('subscription one follow-up cycle', async () => {
    // TODO(agent)
  });

  it('voucher cashback smoke', async () => {
    // TODO(agent)
  });

  it('fetch-by-id compatibility smoke', async () => {
    // TODO(agent):
    // 1. choose one small delivery scenario,
    // 2. send bank webhook body as { id: eventId },
    // 3. verify bank fetches full event from MyOS,
    // 4. keep this test tiny and separate from the main full-payload flow.
  });
});
