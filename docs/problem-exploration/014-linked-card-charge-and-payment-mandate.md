# Problem Exploration - Linked/Reverse Card Charge + Payment Mandate (Demo Bank)

## Date

2026-02-12

## Update note (2026-02-13)

Mandate handling is refined to an asynchronous authorization/settlement handshake
with deterministic correlation via `chargeAttemptId` and mandate-owned spend
state updates.

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
  be auto-accepted by policy when mandate allows.
- webhook lag/retries must not break cumulative mandate limits.

## Key questions addressed

### 1) Should this be modeled as Reserve/Capture variants?

No. Keep them separate:

- reserve/capture remain “operate on existing payment context” requests,
- linked/reverse charge requests represent “initiate a new card transaction”.

### 2) Should bank skip Delivery when mandate exists?

For consistency and observability, Delivery remains the mechanism for starting
new PayNotes. Mandate can authorize automatic acceptance, so UX is still
frictionless.

### 3) What about Payment Mandate vs Customer Consent priority?

For this workstream, Payment Mandate is needed earlier because it directly gates
money movement. `Conversation/Customer Consent` remains important but is moved
to the final stage of this roadmap.

### 4) How do we avoid race conditions for mandate amount limits?

Mandate must be the single source of truth for spend authorization and running
usage. Bank should not independently “guess” remaining allowance in parallel
paths.

Direction:

- bank derives one stable `chargeAttemptId` per emitted request,
- bank sends `PayNote/Mandate Spend Authorization Requested`,
- mandate responds with approved/rejected,
- only approved attempts execute charge,
- bank sends `PayNote/Mandate Spend Settled` with final deltas,
- mandate updates its own usage state and emits settlement response.

## Scope for this iteration

- Add explicit linked/reverse charge request flow.
- Add Payment Mandate integration point (`paymentMandateDocumentId`) and policy.
- Keep charge-result events separate from linked PayNote startup result events.
- Keep canonical session checks, allow-lists, and explicit reject responses.
- Add async mandate orchestration events with `chargeAttemptId` correlation.
- Track mandate cumulative usage in mandate document state.

## Out of scope (for now)

- final consent-document lifecycle as required for data permissions,
- generalized multi-party routing beyond current merchant/customer pair,
- monthly scheduler/cron logic for subscriptions (manual/event-driven triggers
  are sufficient in this phase).
