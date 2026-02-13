# Solution Design - Linked/Reverse Card Charge + Payment Mandate (Demo Bank)

## Date

2026-02-12

## Update note (2026-02-13)

Mandate processing is refined to an asynchronous saga-style handshake:
authorization request -> authorization response -> charge execution ->
settlement update -> settlement response.

## Summary

This design adds a new bank capability layer for starting card transactions from
contract-emitted events, while keeping PayNote startup on top of Delivery.

Key principles:

- explicit event intent (no inference-heavy routing),
- capability matrix per source contract type,
- mandate-aware policy gating,
- mandate as single source of truth for cumulative usage state,
- separate lifecycle reporting for charge and linked PayNote start.

## Event model

## Request events

- `PayNote/Linked Card Charge Requested`
- `PayNote/Linked Card Charge and Capture Immediately Requested`
- `PayNote/Reverse Card Charge Requested`
- `PayNote/Reverse Card Charge and Capture Immediately Requested`

Common optional payload fields:

- `requestId`
- `paymentMandateDocumentId`
- `paynote`

## Response event groups

### A) Charge responses

- `PayNote/Card Charge Responded`
- `PayNote/Card Charge Completed`

### B) Linked PayNote start responses

- `PayNote/Linked PayNote Start Responded`
- `PayNote/Linked PayNote Started`
- `PayNote/Linked PayNote Start Failed`

Notes:

- `requestId` is propagated only when present in request.
- Charge and linked PayNote responses are separate processes.

## Mandate orchestration events

- `PayNote/Mandate Spend Authorization Requested`
- `PayNote/Mandate Spend Authorization Responded`
- `PayNote/Mandate Spend Settled`
- `PayNote/Mandate Spend Settlement Responded`

`chargeAttemptId` is the mandatory correlation key for this handshake.

## Payment Mandate runtime model

`PayNote/Payment Mandate` in this flow uses:

- identity/scope: `granterType`, `granterId`, `granteeType`, `granteeId`,
- cumulative totals: `amountLimit`, `amountReserved`, `amountCaptured`,
- policy:
  - `allowLinkedPayNote`,
  - `allowedPayNotes` (missing list => wildcard),
  - `allowedPaymentCounterparties` (missing list => wildcard),
  - `sourceAccount` (`root` or concrete account number),
- runtime attempt state:
  - `chargeAttempts[chargeAttemptId]` containing authorization + settlement
    fields.

Mandate operations used by bank:

- `authorizeSpend` for pre-execution decision,
- `settleSpend` for post-execution reconciliation.

## Processing pipeline

### 1) Classify and validate event

1. Parse emitted event.
2. Resolve source contract/document type and validate against capability matrix.
3. Resolve canonical session and root chain context.
4. Apply idempotency gate `(webhookEventId, emittedEventIndex)`.
5. Derive stable `chargeAttemptId` from source event identity.

### 2) Mandate policy gate

1. If `paymentMandateDocumentId` is present:
   - load mandate doc,
   - verify active status, scope, expiry/revocation.
2. Emit `PayNote/Mandate Spend Authorization Requested` to mandate.
3. Wait for `PayNote/Mandate Spend Authorization Responded`.
4. Continue only when mandate responds `approved`.
5. If mandate is missing/invalid:
   - create pending action or reject (policy-driven),
   - emit corresponding charge response.
6. If mandate session linkage is temporarily unavailable but accepted
   pending-action mandate snapshot exists:
   - validate against snapshot,
   - continue with explicit warning log (operationally visible fallback).

### 3) Execute charge

1. Resolve direction (linked vs reverse request type).
2. Resolve funding account and destination account from root context and policy.
3. Run auth-only or auth+capture-immediate path (from request type).
4. Emit charge responses.
5. Emit `PayNote/Mandate Spend Settled` with execution deltas and ids.
6. Persist/observe `PayNote/Mandate Spend Settlement Responded` for final mandate consistency.

### 4) Optional linked PayNote start

If request included `paynote` and charge completed successfully:

1. Bank wraps `paynote` into Delivery payload.
2. Bank bootstraps Delivery bound to created transaction context.
3. Apply auto-accept only when mandate/policy allows.
4. Emit linked PayNote start responses.

## Data and linkage model

For each accepted request, persist causation metadata:

- source contract session/document,
- root card-transaction context,
- `chargeAttemptId`,
- charge transaction/hold id,
- linked delivery session/document id (if created),
- linked paynote session/document id (if started),
- dedupe key `(webhookEventId, emittedEventIndex)`.

Mandate document stores per-attempt runtime state under a single map:

- `chargeAttempts[chargeAttemptId]`:
  - authorization decision and reason,
  - reserved/captured deltas,
  - settlement status,
  - hold/transaction identifiers.

This metadata is used by:

- linked contracts UI,
- transaction details,
- retry/idempotency safety.

## Compatibility and rollout

- Existing reserve/capture/monitoring/bootstrap behavior remains unchanged.
- New event family is additive and enabled only where capability matrix allows.
- Existing consent-document plan remains deferred and unaffected.

## Open design checkpoints before coding

1. Confirm timeout/retry strategy when settlement response is delayed.
2. Confirm final policy defaults for missing/invalid mandates (pending action vs reject)
   per contract type.
3. Confirm rollout of mandate event listeners across webhook lag scenarios.
