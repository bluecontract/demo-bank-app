import { describe, it } from 'vitest';

/**
 * Blueprint serial scenario.
 * Use `DemoSubscription.local.txt` and align helper routes to real contract API.
 */
describe('PayNote live scenario: subscription mandate bootstrap and follow-up cycle', () => {
  it('does init capture, mandate bootstrap and one linked follow-up cycle', async () => {
    // TODO(agent):
    // 1. bootstrap subscription paynote,
    // 2. assert initial capture 1200,
    // 3. assert pending action / bootstrap request for mandate,
    // 4. approve mandate bootstrap,
    // 5. assert payment mandate active,
    // 6. trigger next cycle,
    // 7. assert one additional linked charge and capture.
  });
});
