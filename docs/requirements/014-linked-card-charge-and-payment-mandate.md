# Requirements - Linked/Reverse Card Charge + Payment Mandate (Demo Bank)

## Date

2026-02-12

## Update note (2026-02-13)

Mandate flow is specified as async authorization + settlement with
`chargeAttemptId` correlation and mandate-owned cumulative usage tracking.

## Overview

This iteration extends PayNote integration with explicit contract-driven card
charge initiation and mandate-aware policy.

## Functional Requirements

### FR-1 New charge request event family

Bank MUST support:

- `PayNote/Linked Card Charge Requested`
- `PayNote/Linked Card Charge and Capture Immediately Requested`
- `PayNote/Reverse Card Charge Requested`
- `PayNote/Reverse Card Charge and Capture Immediately Requested`

These events MUST be treated as transaction-initiation requests, not as
reserve/capture requests.

### FR-2 Capability matrix by contract/document type

Bank MUST maintain explicit support matrix:

- globally supported event families,
- event families supported only for selected contract/document types.

If request is unsupported for source contract type, bank MUST respond with an
explicit reject event (not silent ignore).

### FR-3 Request payload

Charge requests MAY include:

- `requestId` (optional, for response correlation only),
- `paymentMandateDocumentId` (optional),
- `paynote` (optional; raw PayNote payload to be started for created txn).

Bank MUST propagate `requestId` in response events only when provided.

### FR-4 Payment mandate gating

When request requires mandate:

- valid active mandate -> bank MAY proceed,
- missing/invalid mandate -> bank MUST follow policy:
  - create pending action, or
  - reject explicitly.

Mandate handling MUST be deterministic and auditable.

### FR-5 Mandate orchestration events (required)

For mandate-gated charge requests bank MUST use:

- `PayNote/Mandate Spend Authorization Requested`
- `PayNote/Mandate Spend Authorization Responded`
- `PayNote/Mandate Spend Settled`
- `PayNote/Mandate Spend Settlement Responded`

Bank MUST execute reserve/capture only after authorization status `approved`.

### FR-6 Correlation and idempotency keys

- Bank MUST derive stable `chargeAttemptId` from source emitted event identity
  (`webhookEventId + emittedEventIndex + sourceDocumentId`).
- `chargeAttemptId` MUST be used across all mandate orchestration events and
  internal attempt persistence.
- `requestId` remains optional business correlation only and MUST NOT be used as
  idempotency key.

### FR-7 Mandate cumulative usage state

Mandate usage limits MUST be validated and updated from mandate document state:

- `amountLimit`
- `amountReserved`
- `amountCaptured`
- per-attempt state under `chargeAttempts[chargeAttemptId]`

Settlement retries MUST be idempotent and MUST NOT double-apply deltas.

### FR-8 Linked PayNote startup path

If request includes `paynote` and charge succeeds:

- bank MUST wrap PayNote in Delivery (caller does not send Delivery directly),
- bank MUST start Delivery for the created transaction context,
- bank MAY auto-accept proposal only when allowed by mandate/policy.

### FR-9 Separate response streams

Bank MUST report charge lifecycle separately from linked PayNote startup
lifecycle.

Charge response events and linked PayNote response events MUST be independent,
ordered by causation, and each must include correlation context.

### FR-10 Idempotency and dedupe

For emitted contract requests, bank MUST dedupe by:

- `(webhookEventId, emittedEventIndex)`.

Charge execution and response emission MUST be idempotent under webhook retries.

### FR-11 Root context constraints

For current scope, linked/reverse charge requests MUST stay in the root
merchant/customer context chain established by the originating card transaction
PayNote flow.

### FR-12 Compatibility with existing reserve/capture behavior

Existing reserve/capture request handling MUST continue to work for current
flows. Linked/reverse charge events MUST not break existing voucher/monitoring
contracts.

### FR-13 Consent docs sequencing

`Conversation/Customer Consent` integration is deferred to a later phase and is
not a release blocker for this iteration.

## Non-functional Requirements

### NFR-1 Observability

Bank MUST log correlation identifiers for:

- source contract session/document,
- webhook event id + emitted index,
- `chargeAttemptId`,
- charge transaction/hold identifiers,
- linked PayNote delivery/start identifiers,
- payment mandate document id (if provided).

### NFR-2 Testability

The flow MUST be covered with unit/integration tests for:

- each request type,
- accept/reject/pending mandate outcomes,
- webhook retry/lag duplicate scenarios for authorization + settlement events,
- charge success/failure,
- linked PayNote start success/failure.
