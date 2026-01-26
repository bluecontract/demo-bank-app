# Research - PayNote & PayNote Delivery State (What a Summary Must Explain)

## Date

2026-01-20

## Goal

For the demo bank “Contracts” view, the most useful summary is not a prose rewrite of the document — it’s a clear explanation of:

- What this document represents (in human terms).
- What state it is currently in.
- What has already happened (timeline).
- What is blocked / pending (if determinable from state).

This document captures the state-bearing fields and operations for the two supported contract types today:

- `PayNote/PayNote`
- `PayNote/PayNote Delivery`

## PayNote (core fields)

Repository definition:

- `blue-repository/PayNote/PayNote.blue` (source), also available as package metadata in `@blue-repository/types` (`packages/paynote/contents/PayNote`)

Notable state fields:

- `status` (Text): “Pending / Approved / Reserved / Captured / Released / Rejected …”
- `currency` (Text)
- `amount.total` (Integer, minor units)
- `amount.reserved` (Integer, minor units)
- `amount.captured` (Integer, minor units)
- `payNoteInitialStateDescription.summary` / `.details` (Text, Markdown suggested)

Summary relevance:

- The PayNote’s `status` plus the `amount` breakdown is usually the clearest “current state”.
- The initial description fields are often user-friendly, but cannot be assumed present or accurate (they are free-text).

## PayNote Delivery (core fields + operations)

Repository definition:

- `blue-repository/PayNote/PayNoteDelivery.dev.blue` (source), also available as package metadata in `@blue-repository/types` (`packages/paynote/contents/PayNoteDelivery`)

Notable state fields:

- `deliveryStatus` (Conversation/Document Status): high-level status (Pending / In Progress / Completed / Failed)
- `transactionIdentificationStatus` (Text): `pending | identified | failed`
- `clientDecisionStatus` (Text): `pending | accepted | rejected`
- `clientAcceptedAt` / `clientRejectedAt` (Common/Timestamp)
- `deliveryError` (Text)
- `payNoteBootstrapRequest` (Conversation/Document Bootstrap Requested): contains embedded PayNote doc to be bootstrapped on acceptance

Notable operations (as defined in the repository contract):

- `updateTransactionIdentificationStatus` (channel: `payNoteReceiver`, request: Boolean)
- `acceptPayNote` (channel: `payNoteReceiver`, request: `{ acceptedAt: Common/Timestamp }`)
- `rejectPayNote` (channel: `payNoteReceiver`, request: `{ reason?: Text, rejectedAt: Common/Timestamp }`)

Bank API special handling (important for “current state”):

- `demo-bank-app/apps/bank-api/src/contracts/runContractOperation.ts`
  - Auto-fills `acceptedAt` / `rejectedAt` when client invokes accept/reject without timestamps.
  - Prevents decision operations when identification is not `identified`.
  - Prevents decision operations after a decision is already recorded.

Summary relevance:

- A good summary should make the identification gate explicit (“cannot decide until identified”).
- A good summary should distinguish between delivery status vs identification vs decision status.
- `deliveryError` should be shown only when status indicates failure (or when non-empty).
- A good summary should explain the **behavioral consequence** of acceptance: accepting emits a `Conversation/Document Bootstrap Requested` payload for the embedded PayNote, which (in Demo Bank) leads the bank to bootstrap/start that PayNote.

## Implications for an LLM-generated summary

For high precision, do not rely on the model to “infer” state logic.

Instead:

- Extract these state fields deterministically.
- Encode type-specific rules in code (or a template) for what to show and what it means.
- Use the LLM mainly to phrase a short, user-facing explanation of the extracted state, while forcing it to stay within a schema.
