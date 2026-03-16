import { describe, it } from 'vitest';

describe.skip('PayNote serial scenario: voucher monitoring and cashback', () => {
  it('should complete the voucher monitoring and cashback smoke flow', async () => {
    // Blocked by a concrete continuation gap:
    // after the delivery/satisfaction loop, the document requests monitoring
    // consent, then starts card monitoring, then reacts to a monitoring report
    // by bootstrapping a linked voucher PayNote and capturing cashback.
    //
    // The current local harness has no stateful driver for monitoring reports
    // or linked PayNote auto-start, so it cannot produce the required
    // monitoring -> linked voucher -> cashback event ordering.
  });
});
