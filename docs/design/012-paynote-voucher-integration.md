# Solution Design - PayNote Voucher Flow + Pending Actions + Inbox UX (Demo Bank)

## Date

2026-01-30

## Update note (2026-02-12)

Design for contract-driven linked/reverse charge requests and Payment Mandate
policy is documented in:

- `docs/design/015-linked-card-charge-and-payment-mandate.md`

This document remains the baseline for Delivery/proposal UX, monitoring pending
actions, and Inbox-oriented contract presentation.

## Summary

We implement:

- Delivery-internal proposal flow for Card Transaction PayNotes.
- Voucher behavior as merchant-defined Merchant-to-Customer PayNote.
- Monitoring approval as a generic Pending Action in the contract view.
- Consent as a generic `Conversation/Customer Consent` contract (managed via Data permissions entry, not dedicated contracts tabs).
- Inbox-style contracts UX (Gmail-like list, Inbox-first, no contracts tabs in this iteration).
- Summary regeneration on every contract change, returning structured JSON (`overallSummary`, `lastChangeSummary`, `nextStepsSummary`) and stored history entries.

## Key design decisions

### A) Sender display resolution

Contracts list shows “sender”:

- Primary: merchant display name from the merchant account stored in the bank (by merchantId).
- Fallback: if merchant account missing, use `merchantName` / `merchantStatementDescriptor` from the related card transaction record.

### B) Summary gating without “loading summary”

We must avoid a UI state where contract content is updated but summary is still generating.

We store two epochs per contract:

- `latestEpoch`: last ingested MyOS document epoch
- `summaryEpoch`: last epoch for which summary JSON is stored

The UI only surfaces state at `summaryEpoch`. If `latestEpoch > summaryEpoch`, the update is still processing and is not surfaced as “new”. Once the summary job completes, `summaryEpoch` catches up and the UI can show the updated contract instantly.

### C) History is UX-first

We store human-readable history messages with only three kinds:

- `contractUpdated`
- `pendingActionRequested`
- `bankLifecycle`

We do not store separate “operationExecuted” history kinds; user operations and decisions should appear through `contractUpdated` messages produced by the summary generator.

### D) Consent model

We only support one consent type:

- `Conversation/Customer Consent`

Card monitoring consent is represented by a **document instance** of that type (name/description + details).

Channel roles:

- `granteeChannel`: merchant (MyOS timeline account)
- `guarantorChannel`: bank (admin channel)
- `granterChannel`: bank representation of the customer (customer has no MyOS account)

The consent document is visible to the bank customer via a low-visibility **Data permissions** entry and can be revoked there.

## Data model

### Contracts table

Fields (selected):

- ids: `sessionId`, `documentId`
- `typeBlueId`, `typeName`
- `category`: `contract` | `consent`
- `archivedAt`
- sender:
  - `senderMerchantId`
  - `senderDisplayName` (resolved; may be fallback from transaction descriptor)
- epochs:
  - `latestEpoch`
  - `summaryEpoch`
- summaries (JSON fields):
  - `overallSummary`
  - `lastChangeSummary`
  - `nextStepsSummary`
- `lastUpdatedAt` (derived from summaryEpoch timestamp)
- correlation:
  - `relatedTransactionIds[]`
  - `relatedContractSessionIds[]`

Category detection:

- consent if `blue.isTypeOf(document, CustomerConsentSchema, { checkSchemaExtensions: true })`

### PendingActions table

Fields:

- `id`, `contractSessionId`
- `type`: `consentApproval` | `callOperation`
- `title`, `message`, `detailsJson`
- optional for callOperation:
  - `operationName`
  - `prefillRequestJson`
- `status`: `pending` | `accepted` | `rejected` | `completed`
- timestamps: `createdAt`, `resolvedAt`

### History table

Fields:

- `id`, `contractSessionId`, `createdAt`
- `kind`: `contractUpdated` | `pendingActionRequested` | `bankLifecycle`
- `message` (human readable)
- optional `payloadJson`

## Summary generation

### Trigger

On every document webhook (DOCUMENT_CREATED / DOCUMENT_EPOCH_ADVANCED):

1. Persist raw update, update `latestEpoch`.
2. Enqueue summary job for `(contractSessionId, latestEpoch)`.

### Job

Inputs:

- current doc snapshot,
- previous summary JSON (for diff context),
- pending actions snapshot,
- recent bank lifecycle notes (optional).

Prompt output must be valid JSON:

```json
{
  "overallSummary": "string",
  "lastChangeSummary": "string",
  "nextStepsSummary": "string"
}
```

On successful parse:

- persist fields
- set `summaryEpoch = latestEpoch`
- append History entry `{ kind: contractUpdated, message: lastChangeSummary }`

If parsing fails:

- retry (bounded),
- do not advance summaryEpoch until success.

### Dev tool

Replace “Regenerate” with a dev-only modal:

- shows the prompt template and input payload,
- allows editing prompt and re-running,
- disabled/hidden in production.

## Inbox UX

### List view

- Full page list.
- Columns:
  - senderDisplayName
  - contract name
  - truncated lastChangeSummary
  - lastUpdatedAt
- Contracts list is Inbox-only in this iteration (`category=contract` and active items by default).
- Consent contracts (`category=consent`) are reachable from a low-visibility **Data permissions** entry in side/burger navigation.

### Contract view

- Opens on separate page with back button.
- Sections:
  - summaries (overall + next steps),
  - pending actions (rendered first),
  - contract operations and details,
  - tabs: Details / History.

## Monitoring flow with pending actions

### Request

Voucher emits `PayNote/Start Card Transaction Monitoring Requested`.

Bank:

- validates eligibility,
- creates PendingAction(type=consentApproval) for the voucher contract,
- creates History entry(kind=pendingActionRequested, message="Monitoring consent requested").

### Approval

Customer accepts pending action in contract view:

- bank bootstraps `Conversation/Customer Consent` doc (name: “Card Transaction Monitoring Customer Consent”),
- bank resolves PendingAction(status=accepted),
- bank injects `PayNote/Card Transaction Monitoring Started` into voucher contract including consent refs,
- bank activates monitoring subscription and starts injecting `PayNote/Card Transaction Report`.

### Rejection

Customer rejects pending action:

- bank resolves PendingAction(status=rejected),
- bank injects `PayNote/Card Transaction Monitoring Request Rejected` into voucher contract.

### Revocation

Customer revokes from Data permissions view (consent details):

- bank executes revoke operation on consent doc,
- bank stops monitoring subscriptions,
- bank injects `PayNote/Card Transaction Monitoring Stopped` into voucher contract(s) with reason,
- bank appends History(kind=bankLifecycle) where relevant.

## Notes on testing

For reliability and speed, end-to-end tests should simulate external integrations by:

- posting webhook fixtures into the bank webhook handler,
- verifying DB state, pending actions, summaries, and UI APIs.

Direct external-system E2E is out of scope for this plan and can be addressed separately.
