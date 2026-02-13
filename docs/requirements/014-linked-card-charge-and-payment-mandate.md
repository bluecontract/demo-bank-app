# Requirements - Linked/Reverse Card Charge + Payment Mandate (Demo Bank)

## Date

2026-02-12

## Update note (2026-02-13)

Payment Mandate flow is specified as async authorization + settlement with
`chargeAttemptId` correlation and Payment Mandate-owned cumulative usage
tracking.

## Overview

This iteration extends PayNote integration with explicit contract-driven card
charge initiation and Payment Mandate-aware policy.

## Functional Requirements

### FR-1 New charge request event family

Bank MUST support:

- `PayNote/Linked Card Charge Requested`
- `PayNote/Linked Card Charge and Capture Immediately Requested`
- `PayNote/Reverse Card Charge Requested`
- `PayNote/Reverse Card Charge and Capture Immediately Requested`

These events MUST be treated as transaction-initiation requests, not as
reserve/capture requests.

Direction semantics for current scope:

- `PayNote/Linked ...` is interpreted in the context of the emitting contract as
  `payerChannel -> payeeChannel`.
- `PayNote/Reverse ...` is interpreted in the context of the emitting contract as
  `payeeChannel -> payerChannel`.
- Direction semantics MUST NOT depend on prior contracts in the chain.

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
- `paymentMandate` definition (optional, reserved for future contract-level metadata),
- `paynote` (optional; raw PayNote payload to be started for created txn).

Bank MUST propagate `requestId` in response events only when provided.

For current scope, bank MUST NOT create/bootstrap Payment Mandate from
`paymentMandate` in charge request payload. Payment Mandate provisioning is
explicit via `Conversation/Document Bootstrap Requested`.

### FR-4 Payment Mandate gating

When request requires Payment Mandate:

- valid active Payment Mandate -> bank MAY proceed,
- missing/invalid Payment Mandate -> bank MUST reject explicitly.

Payment Mandate handling MUST be deterministic and auditable.

### FR-4a Payment Mandate bootstrap is explicit and separate

If contract needs a new Payment Mandate document, it MUST use explicit bootstrap
flow (`Conversation/Document Bootstrap Requested`) before emitting
Payment Mandate-gated charge/capture requests.

Bank MUST NOT auto-create Payment Mandate from charge request fallback policy.

### FR-5 Payment Mandate orchestration events (required)

For Payment Mandate-gated charge requests bank MUST use:

- `PayNote/Payment Mandate Spend Authorization Requested`
- `PayNote/Payment Mandate Spend Authorization Responded`
- `PayNote/Payment Mandate Spend Settled`
- `PayNote/Payment Mandate Spend Settlement Responded`

Bank MUST execute reserve/capture only after authorization status `approved`.

### FR-6 Correlation and idempotency keys

- Bank MUST derive stable `chargeAttemptId` from source emitted event identity
  (`webhookEventId + emittedEventIndex + sourceDocumentId`).
- `chargeAttemptId` MUST be used across all Payment Mandate orchestration events
  and internal attempt persistence.
- `requestId` remains optional business correlation only and MUST NOT be used as
  idempotency key.

### FR-7 Payment Mandate cumulative usage state

Payment Mandate usage limits MUST be validated and updated from Payment Mandate
document state:

- `amountLimit`
- `amountReserved`
- `amountCaptured`
- per-attempt state under `chargeAttempts[chargeAttemptId]`

Settlement retries MUST be idempotent and MUST NOT double-apply deltas.

### FR-7a Payment Mandate state contract

`PayNote/Payment Mandate` MUST be modeled with:

- cumulative totals: `amountLimit`, `amountReserved`, `amountCaptured`,
- per-attempt state: `chargeAttempts[chargeAttemptId]`.

The implementation MUST treat `chargeAttempts` as the canonical per-attempt
state store (no split per-attempt maps in bank state).

### FR-7b Policy lists and source account semantics

- `allowedPayNotes` missing/empty MUST mean wildcard (any PayNote allowed).
- `allowedPaymentCounterparties` missing/empty MUST mean wildcard (any
  counterparty allowed).
- `sourceAccount` MUST support `"root"` and concrete account number values.
- For current linked/reverse card charge flow, bank MUST support `"root"` and
  reject unsupported source-account modes with explicit response reason.
- `sourceAccount = "root"` means "use effective payer source resolved by bank
  from request direction + emitting-contract context".
- For any source-account mode, bank MUST enforce ownership:
  effective source account/funding context MUST belong to Payment Mandate
  granter; otherwise request MUST be rejected explicitly.

### FR-7c Payment Mandate operations

Payment Mandate documents used in this flow MUST expose operations:

- `authorizeSpend` (request type
  `PayNote/Payment Mandate Spend Authorization Requested`),
- `settleSpend` (request type `PayNote/Payment Mandate Spend Settled`).

Bank MUST call these operations for Payment Mandate-gated charge flow.

### FR-8 Linked PayNote startup path

If request includes `paynote` and charge succeeds:

- bank MUST wrap PayNote in Delivery (caller does not send Delivery directly),
- bank MUST start Delivery for the created transaction context,
- bank MAY auto-accept proposal only when allowed by Payment Mandate/policy.

### FR-9 Separate response streams

Bank MUST report charge lifecycle separately from linked PayNote startup
lifecycle.

Charge response events and linked PayNote response events MUST be independent,
ordered by causation, and each must include correlation context.

### FR-9a Payment Mandate attachment events (minimal payload)

Bank MUST support explicit PayNote-side attachment events:

- `PayNote/Payment Mandate Attached`:
  - required: `paymentMandateDocumentId`,
  - optional correlation: `inResponseTo.requestId` when source request had `requestId`.
- `PayNote/Payment Mandate Attachment Failed`:
  - required: `reason`,
  - optional correlation: `inResponseTo.requestId` when source request had `requestId`.

### FR-10 Idempotency and dedupe

For emitted contract requests, bank MUST dedupe by:

- `(webhookEventId, emittedEventIndex)`.

Charge execution and response emission MUST be idempotent under webhook retries.

### FR-11 Root context constraints

For current scope, linked/reverse charge direction and payer/payee routing MUST
be resolved from the emitting contract context (local channel bindings).

Root chain context is the resolved canonical tuple propagated from the
originating card-transaction flow and includes at least:

- root customer identity,
- root customer payment source/account context,
- root merchant identity,
- root merchant funding source context.

Bank MUST use root chain context only for policy guards and compatibility checks
(for example allowed participant pair / chain membership constraints), not for
deriving linked/reverse direction semantics.

### FR-12 Compatibility with existing reserve/capture behavior

Existing reserve/capture request handling MUST continue to work for current
flows. Linked/reverse charge events MUST not break existing voucher/monitoring
contracts.

### FR-12a Card Transaction Report required fields

Bank-emitted `PayNote/Card Transaction Report` MUST always include at least:

- `transactionId`,
- `merchantId`,
- `amountMinor`,
- `currency`,
- `occurredAt`,
- `status` (`authorized | partially captured | captured`).

Other report fields may stay optional.

### FR-13 Consent docs sequencing

`Conversation/Customer Consent` integration is deferred to a later phase and is
not a release blocker for this iteration.

### FR-14 Payment Mandate linkage lag behavior

If Payment Mandate session linkage is temporarily unavailable, bank MUST NOT
execute charge based only on local bootstrap/persistence snapshot.

Bank MUST:

- keep request in internal retry state while retry policy is active (without
  accepted charge response),
- execute charge only after Payment Mandate authorization is confirmed,
- return explicit technical reject when retry policy is exhausted.

## Non-functional Requirements

### NFR-1 Observability

Bank MUST log correlation identifiers for:

- source contract session/document,
- webhook event id + emitted index,
- `chargeAttemptId`,
- charge transaction/hold identifiers,
- linked PayNote delivery/start identifiers,
- Payment Mandate document id (if provided).

### NFR-2 Testability

The flow MUST be covered with unit/integration tests for:

- each request type,
- accept/reject and technical-timeout Payment Mandate outcomes,
- webhook retry/lag duplicate scenarios for authorization + settlement events,
- charge success/failure,
- linked PayNote start success/failure.
