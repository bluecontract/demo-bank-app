# Requirements - PayNote Voucher Flow + Pending Actions + Inbox UX (Demo Bank)

## Date

2026-01-30

## Overview

This iteration delivers:

- card-linked PayNote proposals using `PayNote/Card Transaction PayNote` transported via PayNote Delivery,
- voucher behavior as a merchant-defined `PayNote/Merchant To Customer PayNote` instance,
- card transaction monitoring requiring customer approval and resulting in a consent contract (`Conversation/Customer Consent`),
- customer Pending Actions as a generic UX mechanism,
- inbox-style contracts UX (Gmail-like) with tabs and archive,
- summary regeneration on every contract change, returning structured JSON that includes a short list preview sentence,
- stored human-readable contract history.

## Functional Requirements

### FR-1 PayNote Delivery is not shown to customers

- Bank MUST bootstrap PayNote Delivery documents for inbound proposals.
- Customer MUST NOT see PayNote Delivery in:
  - contract list,
  - contract detail,
  - related contracts.
- Bank MUST still update PayNote Delivery with outcomes for processor/merchant consumption.

### FR-2 Proposal UX derived from Delivery

- Bank MUST present a proposal UI derived from the embedded PayNote template in Delivery.
- Proposal UI MUST show:
  - paynote name/description/amount/currency,
  - related card transaction (after identification),
  - Accept / Reject actions.
- Proposal acceptance is required before bootstrapping the PayNote.

### FR-3 Acceptance bootstraps PayNote; rejection does not

- Accept/Reject in bank UI MUST be recorded in PayNote Delivery (bank channel).
- Accept MUST trigger PayNote bootstrap.
- Reject MUST NOT bootstrap PayNote.
- Processor MUST learn the outcome from PayNote Delivery updates.

### FR-4 Only Card Transaction PayNote is accepted from merchants for card flow

- Embedded PayNote template MUST be `PayNote/Card Transaction PayNote`.
- Unsupported embedded type MUST be rejected:
  - Delivery marked failed with reason,
  - no proposal shown,
  - no PayNote bootstrapped.

### FR-5 Card transaction identification and participant validation

A proposal is valid only if:

- `cardTransactionDetails` identifies a bank-known card transaction and customer.
- Payee matches the sending merchant context.
- Payer is not set by merchant (bank sets payer bindings at bootstrap).

On failure: Delivery is marked failed/ignored and proposal is not shown.

### FR-6 PayNote transaction status tracking

- `PayNote/PayNote` MUST include `transactionStatus: PayNote/Transaction Status`.
- If proposal includes `transactionStatus`, bank MUST validate it matches current bank transaction state.
- If missing, bank MUST set it at PayNote bootstrap.
- If validation fails, Delivery MUST be rejected with reason.

### FR-7 Allow-listed child contract bootstrap

- Bank MUST maintain allow-list of child contract types bootstrappable from PayNotes.
- Allow-list MUST include `PayNote/Merchant To Customer PayNote`.
- Unsupported bootstrap requests MUST be rejected and requesting contract informed (via injected event).

### FR-8 Standard bank-to-document update operation

- Supported PayNotes MUST expose one bank-known operation (e.g., `guarantorUpdate`) that injects events into the contract timeline.
- Bank MUST use injected events for results/reports (no contract-specific “confirm/report” operations).

### FR-9 Funds reservation capability

- `PayNote/Reserve Funds Requested` → bank creates hold (policy-validated) → injects `PayNote/Funds Reserved`.
- If disallowed → inject `PayNote/Reservation Declined` with reason.

### FR-10 Funds capture capability

- `PayNote/Capture Funds Requested` → bank captures (policy-validated) → inject `PayNote/Funds Captured`.
- If disallowed → inject `PayNote/Capture Declined` with reason.
- On error → inject `PayNote/Capture Failed`.
- Capture MUST be idempotent keyed by reported bank transaction id.

### FR-11 Monitoring request creates a Pending Action

- When a contract emits `PayNote/Start Card Transaction Monitoring Requested`, bank MUST:
  - validate eligibility,
  - create a Pending Action (type: consent approval) linked to the contract,
  - display this Pending Action in the contract view.

### FR-12 Monitoring approval bootstraps consent contract and starts monitoring

If customer approves the pending action:

- Bank MUST bootstrap a contract of type `Conversation/Customer Consent` with:
  - `granteeChannel` = merchant,
  - `guarantorChannel` = bank,
  - `granterChannel` = bank representation of the customer (the customer has no MyOS account),
  - human-readable name/description (e.g., “Card Transaction Monitoring Customer Consent”),
  - consent scope details stored in the consent document (e.g., merchant id, event categories, requesting contract id/session id).
- Bank MUST inject `PayNote/Card Transaction Monitoring Started` into the requesting contract with:
  - `consentDocumentId` and `consentSessionId`.
- Bank MUST start monitoring and inject `PayNote/Card Transaction Report` events when matches occur.

### FR-13 Monitoring rejection informs contract

If customer rejects the pending action:

- Bank MUST inject `PayNote/Card Transaction Monitoring Request Rejected` with reason.

### FR-14 Consent revocation stops monitoring and informs contract

- Consent contract MUST provide revoke operation to the granterChannel.
- On consent revoke:
  - bank MUST stop monitoring and stop emitting reports,
  - bank MUST inject `PayNote/Card Transaction Monitoring Stopped` into requesting contract(s) with reason.

### FR-15 Pending Actions types and rendering

Bank MUST support at minimum:

- **consentApproval**: Accept/Reject buttons + consent details (no operation form).
- **callOperation** (optional in this iteration, feature-flagged):
  - pending action stores `operationName` and optional `prefillRequest`,
  - UI opens operation form prefilled (user can edit) and then executes operation.

Optionally, a document may emit `Conversation/Customer Action Requested` to suggest a pending action (bank may accept/ignore).

### FR-16 Inbox-style contracts list and navigation

- Contracts list is full-page (Gmail-like).
- Clicking a contract opens a dedicated contract page with a back button.

List columns:

- sender,
- contract name,
- last change preview sentence,
- last updated timestamp.

### FR-17 Tabs: Inbox / Archived / Consents

- Tabs MUST exist:
  - Inbox: active non-consent contracts
  - Archived: archived non-consent contracts
  - Consents: consent contracts only (`Conversation/Customer Consent` detected via schema type check)
- Consent contracts MUST NOT appear in Inbox/Archived.

### FR-18 Archive behavior

- User can archive from list or contract view.
- Archived contracts are hidden from Inbox, appear under Archived, remain accessible.
- Archived contracts should not trigger inbox notifications/badges.

### FR-19 Summary generation is structured JSON and regenerated on every change

- Bank MUST generate and store, for each contract update, a JSON object matching schema:

```json
{
  "overallSummary": "string",
  "lastChangeSummary": "string",
  "nextStepsSummary": "string"
}
```

Constraints:

- `lastChangeSummary` is a single short sentence suitable for list preview.
- `overallSummary` describes current contract state.
- `nextStepsSummary` suggests next actions (including pending actions).

- The LLM prompt MUST require output in this JSON format and the bank MUST validate JSON parsing before persisting.
- Bank MUST regenerate this summary on every contract change (webhook-driven).
- Bank MUST NOT generate summaries on-read.
- Bank MUST surface contract updates to the user only after the new JSON summary is persisted (no UI waiting for LLM).

### FR-20 Human-readable contract history

- Bank MUST store history entries with timestamp and a message.
- History kinds SHOULD be limited to:
  - `contractUpdated` (message derived from lastChangeSummary),
  - `pendingActionRequested` (e.g., “Monitoring consent requested”),
  - `bankLifecycle` (significant external events, e.g., “Consent revoked”).

## Non-functional Requirements

### NFR-1 Idempotency

- Transaction reports have unique `transactionId`.
- Voucher must deduplicate by transactionId.
- Captures are idempotent keyed by report transactionId.

### NFR-2 UX responsiveness

- Contract view must load instantly; no “updating summary” state.
- Updates appear only after summary regeneration completes.

### NFR-3 Observability

Log correlation ids:

- delivery session/document ids,
- paynote session/document ids,
- transaction id, merchant id,
- consent session/document ids,
- pending action ids.
