import { describe, it } from 'vitest';

describe.skip('PayNote serial scenario: subscription mandate cycle', () => {
  it('should bootstrap the mandate and process one follow-up cycle', async () => {
    // Blocked by a concrete continuation gap:
    // this flow needs
    // 1. initial capture,
    // 2. `Conversation/Document Bootstrap Requested` for the payment mandate,
    // 3. customer approval of the bootstrap pending action,
    // 4. a bootstrap target-session response and bootstrap-completion webhook,
    // 5. one linked follow-up charge cycle after the mandate is active.
    //
    // The current local harness does not synthesize the target mandate session
    // or the bootstrap completion event that links the active mandate back to
    // the requesting PayNote session.
  });
});
