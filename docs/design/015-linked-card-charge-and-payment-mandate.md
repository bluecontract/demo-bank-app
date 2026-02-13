# Solution Design - Linked/Reverse Card Charge + Payment Mandate (Demo Bank)

## Date

2026-02-12

## Update note (2026-02-13)

Payment Mandate processing is refined to an asynchronous saga-style handshake:
authorization request -> authorization response -> charge execution ->
settlement update -> settlement response.

Detailed alignment corrections for reliability and voucher/subscription behavior
are captured in:

- `docs/design/016-mandate-reliability-voucher-subscription-alignment.md`

## Summary

This design adds a new bank capability layer for starting card transactions from
contract-emitted events, while keeping PayNote startup on top of Delivery.

Key principles:

- explicit event intent (no inference-heavy routing),
- capability matrix per source contract type,
- Payment Mandate-aware policy gating,
- Payment Mandate as single source of truth for cumulative usage state,
- separate lifecycle reporting for charge and linked PayNote start.

## Event model

Direction semantics (current scope):

- `PayNote/Linked ...` means `payerChannel -> payeeChannel` in emitting-contract
  context.
- `PayNote/Reverse ...` means `payeeChannel -> payerChannel` in emitting-contract
  context.
- Direction semantics do not depend on historical contracts in chain.

## Request events

- `PayNote/Linked Card Charge Requested`
- `PayNote/Linked Card Charge and Capture Immediately Requested`
- `PayNote/Reverse Card Charge Requested`
- `PayNote/Reverse Card Charge and Capture Immediately Requested`

Common optional payload fields:

- `requestId`
- `paymentMandateDocumentId`
- `paymentMandate` (reserved for future metadata; does not bootstrap mandate in current scope)
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

## Payment Mandate orchestration events

- `PayNote/Payment Mandate Spend Authorization Requested`
- `PayNote/Payment Mandate Spend Authorization Responded`
- `PayNote/Payment Mandate Spend Settled`
- `PayNote/Payment Mandate Spend Settlement Responded`

`chargeAttemptId` is the mandatory correlation key for this handshake.

## Payment Mandate attachment events (PayNote context)

- `PayNote/Payment Mandate Attached`
  - minimal payload: `paymentMandateDocumentId`
  - optional: `inResponseTo.requestId` when available
- `PayNote/Payment Mandate Attachment Failed`
  - minimal payload: `reason`
  - optional: `inResponseTo.requestId` when available

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

Payment Mandate operations used by bank:

- `authorizeSpend` for pre-execution decision,
- `settleSpend` for post-execution reconciliation.

## Processing pipeline

### 1) Classify and validate event

1. Parse emitted event.
2. Resolve source contract/document type and validate against capability matrix.
3. Resolve canonical session and root chain context.
4. Resolve effective charge direction from event type in emitting-contract
   context:
   - linked => `payerChannel -> payeeChannel`,
   - reverse => `payeeChannel -> payerChannel`.
5. Resolve effective source/destination accounts from emitting-contract context.
6. Apply root-chain compatibility guards (policy-only), for example:
   - allowed merchant/customer pair constraints,
   - chain membership constraints.
7. Validate `sourceAccount` mandate policy against resolved effective source:
   - `root` => accept resolved source account/funding context,
   - explicit account number => (future extension) must match resolved source;
     unsupported mode is explicit reject in current scope.
8. Enforce ownership invariant:
   - resolved effective source MUST belong to Payment Mandate granter,
   - if source owner != granter => explicit reject.
9. Apply idempotency gate `(webhookEventId, emittedEventIndex)`.
10. Derive stable `chargeAttemptId` from source event identity.

### 2) Payment Mandate policy gate

1. If `paymentMandateDocumentId` is present:
   - load Payment Mandate doc,
   - verify active status, scope, expiry/revocation.
2. Emit `PayNote/Payment Mandate Spend Authorization Requested` to Payment Mandate.
3. Wait for `PayNote/Payment Mandate Spend Authorization Responded`.
4. Continue only when Payment Mandate responds `approved`.
5. If Payment Mandate is missing/invalid:
   - reject explicitly,
   - emit corresponding charge response.
   - if Payment Mandate creation is needed, contract must run explicit
     `Conversation/Document Bootstrap Requested` flow first.
6. If Payment Mandate session linkage is temporarily unavailable:
   - do not execute charge on snapshot-only assumptions,
   - keep request in internal retry state while retries are in progress,
   - reject with explicit technical reason only after retry policy is exhausted.

### 3) Execute charge

1. Use already-resolved direction + account routing from step 1 pipeline.
2. Run auth-only or auth+capture-immediate path (from request type).
3. Emit charge responses.
4. Emit `PayNote/Payment Mandate Spend Settled` with execution deltas and ids.
5. Persist/observe `PayNote/Payment Mandate Spend Settlement Responded` for final Payment Mandate consistency.

### 4) Optional linked PayNote start

If request included `paynote` and charge completed successfully:

1. Bank wraps `paynote` into Delivery payload.
2. Bank bootstraps Delivery bound to created transaction context.
3. Apply auto-accept only when Payment Mandate/policy allows.
4. Emit linked PayNote start responses.

### 5) Card transaction report payload contract

`PayNote/Card Transaction Report` emitted by bank must include:

- `transactionId`
- `merchantId`
- `amountMinor`
- `currency`
- `occurredAt`
- `status` (`authorized | partially captured | captured`)

Other fields remain optional.

## Data and linkage model

For each accepted request, persist causation metadata:

- source contract session/document,
- root card-transaction context,
- `chargeAttemptId`,
- charge transaction/hold id,
- linked delivery session/document id (if created),
- linked paynote session/document id (if started),
- dedupe key `(webhookEventId, emittedEventIndex)`.

Payment Mandate document stores per-attempt runtime state under a single map:

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
2. Confirm final timeout value and retry backoff policy for technical Payment Mandate failures.
3. Confirm rollout of Payment Mandate event listeners across webhook lag scenarios.
