import { describe, it } from 'vitest';

/**
 * Blocked locally with hard evidence from a real harness run on 2026-03-16:
 * 1. The raw contract is persisted in Dynamo and already contains the pending
 *    customer action.
 * 2. The customer-facing `GET /v1/contracts/:sessionId` route still returns
 *    `404 Contract summary not available`, so the pending action never becomes
 *    visible through the normal bank read model.
 * 3. Bypassing that route and deciding the raw pending action directly still
 *    does not make the root-only shortcut capturable: the follow-up
 *    `PayNote/Capture Funds Requested` is declined with `Missing hold mapping`.
 *
 * Root cause:
 * - the local harness path does not materialize the summary-backed customer
 *   contract read model for this flow
 * - and the simplified root-only fixture path does not create the hold mapping
 *   that the capture continuation expects.
 *
 * Re-enabling this scenario requires a delivery/bootstrap-backed fixture chain
 * plus local summary/read-model materialization for the customer contract view.
 */
describe.skip('PayNote live scenario: pending installation approval then capture', () => {
  it('should expose the pending action, accept approval, and then capture', async () => {
    // Intentionally skipped until the local harness reproduces the exact
    // customer-visible contract and hold-mapping continuation for this flow.
  });
});
