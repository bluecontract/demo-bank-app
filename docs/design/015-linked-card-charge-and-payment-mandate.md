# Solution Design - Linked/Reverse Card Charge + Payment Mandate (Demo Bank)

## Date

2026-02-12

## Summary

This design adds a new bank capability layer for starting card transactions from
contract-emitted events, while keeping PayNote startup on top of Delivery.

Key principles:

- explicit event intent (no inference-heavy routing),
- capability matrix per source contract type,
- mandate-aware policy gating,
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

## Processing pipeline

### 1) Classify and validate event

1. Parse emitted event.
2. Resolve source contract/document type and validate against capability matrix.
3. Resolve canonical session and root chain context.
4. Apply idempotency gate `(webhookEventId, emittedEventIndex)`.

### 2) Mandate policy gate

1. If `paymentMandateDocumentId` is present:
   - load mandate doc,
   - verify active status, scope, expiry/revocation.
2. If mandate is missing/invalid:
   - create pending action or reject (policy-driven),
   - emit corresponding charge response.

### 3) Execute charge

1. Resolve direction (linked vs reverse request type).
2. Resolve funding account and destination account from root context and policy.
3. Run auth-only or auth+capture-immediate path (from request type).
4. Emit charge responses.

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
- charge transaction/hold id,
- linked delivery session/document id (if created),
- linked paynote session/document id (if started),
- dedupe key `(webhookEventId, emittedEventIndex)`.

This metadata is used by:

- linked contracts UI,
- transaction details,
- retry/idempotency safety.

## Compatibility and rollout

- Existing reserve/capture/monitoring/bootstrap behavior remains unchanged.
- New event family is additive and enabled only where capability matrix allows.
- Existing consent-document plan remains deferred and unaffected.

## Open design checkpoints before coding

1. Finalize exact payload schema for charge response events.
2. Finalize exact payload schema for linked PayNote start response events.
3. Confirm policy defaults for missing/invalid mandates (pending action vs reject)
   per contract type.
