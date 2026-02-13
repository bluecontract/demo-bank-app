# Problem Exploration - Linked/Reverse Card Charge + Payment Mandate (Demo Bank)

## Date

2026-02-12

## Update note (2026-02-13)

Payment Mandate handling is refined to an asynchronous
authorization/settlement handshake with deterministic correlation via
`chargeAttemptId` and Payment Mandate-owned spend state updates.

Detailed fix/alignment decisions are documented in:

- `docs/design/016-mandate-reliability-voucher-subscription-alignment.md`

## Context

The current implementation already supports:

- PayNote Delivery proposal flow for `PayNote/Card Transaction PayNote`,
- `guarantorUpdate`-based bank-to-contract responses,
- runtime handling of reserve/capture requests,
- bootstrap requests from active PayNotes,
- monitoring subscriptions with pending actions.

The next product goal is to let contracts request new card transactions in a
controlled, explicit way, so voucher cashback and subscription scenarios can be
built without bank-side inference.

## Problem

`PayNote/Reserve Funds Requested` and `PayNote/Capture Funds Requested` are
about operating on existing hold/payment context. They are not sufficient for
starting a brand-new card charge from any contract.

We need explicit events for:

- linked charge in the same merchant/customer card context,
- reverse charge (merchant to card owner),
- both modes: auth-only and auth+immediate-capture.

At the same time:

- bank policy and eligibility checks must remain centralized,
- response semantics must stay deterministic and testable,
- linked PayNote startup should remain Delivery-based for consistency, but may
  be auto-accepted by policy when Payment Mandate allows.
- webhook lag/retries must not break cumulative Payment Mandate limits.

## Key questions addressed

### 1) Should this be modeled as Reserve/Capture variants?

No. Keep them separate:

- reserve/capture remain “operate on existing payment context” requests,
- linked/reverse charge requests represent “initiate a new card transaction”.

For current scope, linked/reverse direction is interpreted in emitting-contract
context (local channels), not from prior chain history:

- linked => `payerChannel -> payeeChannel`,
- reverse => `payeeChannel -> payerChannel`.

### 2) Should bank skip Delivery when Payment Mandate exists?

For consistency and observability, Delivery remains the mechanism for starting
new PayNotes. Payment Mandate can authorize automatic acceptance, so UX is still
frictionless.

### 3) What about Payment Mandate vs Customer Consent priority?

For this workstream, Payment Mandate is needed earlier because it directly gates
money movement. `Conversation/Customer Consent` remains important but is moved
to the final stage of this roadmap.

### 4) How do we avoid race conditions for Payment Mandate amount limits?

Payment Mandate must be the single source of truth for spend authorization and
running usage. Bank should not independently “guess” remaining allowance in
parallel paths.

Direction:

- bank derives one stable `chargeAttemptId` per emitted request,
- bank sends `PayNote/Payment Mandate Spend Authorization Requested`,
- Payment Mandate responds with approved/rejected,
- only approved attempts execute charge,
- bank sends `PayNote/Payment Mandate Spend Settled` with final deltas,
- Payment Mandate updates its own usage state and emits settlement response.

### 5) What is the Payment Mandate state model we standardize on?

Use one cohesive runtime map per attempt, keyed by `chargeAttemptId`:

- Payment Mandate keeps totals in `amountReserved` and `amountCaptured`,
- Payment Mandate keeps per-attempt state in `chargeAttempts[chargeAttemptId]`,
- no split dictionaries per concern (for example separate maps for reasons,
  statuses, amounts).

This keeps correlation deterministic and avoids cross-map drift.

### 6) How are wildcard policies represented?

For both lists below, missing/empty list means wildcard:

- `allowedPayNotes`: any linked PayNote is allowed,
- `allowedPaymentCounterparties`: any counterparty is allowed.

When list entries exist, each entry is explicit and matched as-is.

### 7) How is Payment Mandate source account policy expressed?

Payment Mandate uses one field:

- `sourceAccount = "root"` or concrete account number.

For current linked/reverse card charge scope:

- bank supports `root` source policy,
- account-number source selection can be extended later.

`sourceAccount = "root"` means bank resolves effective funding source from
request direction + emitting-contract context.

Root chain context is still used, but as policy guard only (for example allowed
participant pair and chain membership), not to derive linked/reverse direction.

Ownership invariant:

- resolved effective source must belong to Payment Mandate granter,
- bank must reject when source owner and granter do not match.

## Scope for this iteration

- Add explicit linked/reverse charge request flow.
- Add Payment Mandate integration point (`paymentMandateDocumentId`) and policy.
- Keep charge-result events separate from linked PayNote startup result events.
- Keep canonical session checks, allow-lists, and explicit reject responses.
- Add async Payment Mandate orchestration events with `chargeAttemptId` correlation.
- Track Payment Mandate cumulative usage in Payment Mandate document state.
- Define minimal event payload contracts for:
  - `PayNote/Payment Mandate Attached`,
  - `PayNote/Payment Mandate Attachment Failed`,
  - `PayNote/Card Transaction Report` required business fields.

## Out of scope (for now)

- final consent-document lifecycle as required for data permissions,
- generalized multi-party routing beyond current merchant/customer pair,
- monthly scheduler/cron logic for subscriptions (manual/event-driven triggers
  are sufficient in this phase).
