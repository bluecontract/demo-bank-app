import { describe, it } from 'vitest';

describe.skip('PayNote serial scenario: milestones partial captures', () => {
  it('should capture milestone amounts in order without duplicates', async () => {
    // Blocked by a concrete local-harness gap:
    // the milestone document emits alternating
    // `Conversation/Customer Action Requested` ->
    // `Conversation/Customer Action Responded` ->
    // `PayNote/Capture Funds Requested` ->
    // next `Conversation/Customer Action Requested`.
    //
    // The current harness can record the bank's `guarantorUpdate` call, but it
    // cannot evaluate the document, mutate milestone state, and synthesize the
    // next epoch event chain after each approval.
  });
});
