import { describe, it } from 'vitest';

/**
 * Blueprint serial scenario.
 * Use scaled refrigerator fixture + mandate fixture.
 */
describe('PayNote live scenario: voucher monitoring cashback', () => {
  it('finalizes main flow, starts voucher and captures cashback on monitoring report', async () => {
    // TODO(agent):
    // 1. bootstrap scaled refrigerator paynote,
    // 2. confirm delivery,
    // 3. confirm satisfaction or concern->reschedule->service->satisfaction,
    // 4. attach mandate,
    // 5. assert reverse auth for voucher,
    // 6. assert monitoring requested/started,
    // 7. inject transaction report,
    // 8. assert cashback capture and no duplicate payout on replay.
  });
});
