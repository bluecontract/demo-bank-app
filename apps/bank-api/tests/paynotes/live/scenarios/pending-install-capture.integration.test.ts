import { describe, it } from 'vitest';

/**
 * Blocked locally: the pending-action flow needs a stable delivery -> contract
 * -> pending-action continuation in the local harness before the scenario can
 * be exercised end-to-end.
 */
describe.skip('PayNote live scenario: pending installation approval then capture', () => {
  it('should expose the pending action, accept approval, and then capture', async () => {
    // Intentionally skipped until the local harness reproduces the exact
    // continuation chain needed to materialize the contract pending action.
  });
});
