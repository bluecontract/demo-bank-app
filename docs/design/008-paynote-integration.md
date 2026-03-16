# Solution Design - PayNote Delivery Integration (Demo Bank)

## Date

2026-01-14

## Context

The demo bank must act as the PayNote deliverer and orchestrate PayNote Delivery
bootstrap, webhook-driven updates, transaction identification, and client
decisioning. Delivery/PayNote documents are deduplicated by MyOS `documentId`
(resolved via `GET /documents/{sessionId}` because webhooks do not include it)
and persisted in DynamoDB; local development uses the remote MyOS sandbox with
webhook forwarding to localhost for E2E testing.

References:

- `docs/problem-exploration/007-paynote-integration.md`
- `docs/requirements/007-paynote-integration.md`

## Implementation Notes (Deviations from prior design)

- Delivery-to-hold linking is stored on the bank side by updating the related
  hold metadata with a `payNoteDocumentId` when a PayNote Delivery is received.
  This uses the Delivery `documentId` first (resolved via `GET /documents/{sessionId}`)
  so the activity list and hold details can show a PayNote indicator even before
  a PayNote document exists.
- When the PayNote document is later bootstrapped, the bank updates the same
  hold metadata to the PayNote `documentId` so the UI opens the full PayNote
  details.
- PayNote details may be served from the Delivery record while the PayNote
  document is not yet stored. The details endpoint returns the embedded PayNote
  document with `transactionRequest` / `triggerEvent` set to `null` in this case.

## Proposed Architecture

```mermaid
sequenceDiagram
  participant MyOS as MyOS Sandbox
  participant API as Bank API (PayNote Webhook)
  participant PAY as PayNote Delivery Service
  participant BANK as Banking Facade
  participant DB as DynamoDB
  participant UI as Bank Web App

  MyOS->>API: DOCUMENT_EPOCH_ADVANCED (Synchrony Merchant session)
  API->>PAY: Parse Blue payload + detect bootstrap request
  PAY->>MyOS: POST /documents/bootstrap (PayNote Delivery)
  MyOS-->>API: DOCUMENT_CREATED (Delivery session - deliverer channel)
  MyOS-->>API: DOCUMENT_CREATED (Delivery session - receiver channel)
  API->>MyOS: GET /documents/{deliverySessionId} (resolve documentId)
  API->>PAY: Deduplicate delivery by documentId (fallback cardTransactionDetails)
  PAY->>DB: Store delivery once (full doc + metadata)
  PAY->>DB: Update related hold meta with payNoteDocumentId (delivery documentId)
  PAY->>MyOS: POST /documents/{synchronySessionId}/updateTransactionIdentificationStatus
  UI->>API: Query delivery/PayNote details
  API->>DB: Read delivery/PayNote state
  UI->>API: Accept/Reject delivery
  API->>MyOS: POST /documents/{deliverySessionId}/acceptPayNote or POST /documents/{deliverySessionId}/rejectPayNote
  API->>BANK: [on paynote accepted] Disable capture + bootstrap PayNote
  API->>MyOS: POST /documents/bootstrap (PayNote)
  MyOS-->>API: DOCUMENT_EPOCH_ADVANCED (Document Session Bootstrap)
  API->>PAY: Extract Target Document Session Started
  API->>MyOS: GET /documents/{payNoteSessionId} (resolve documentId)
  API->>DB: Link delivery <-> PayNote and store PayNote state
  API->>DB: Update related hold meta with payNoteDocumentId (PayNote documentId)
  MyOS-->>API: DOCUMENT_EPOCH_ADVANCED (PayNote session)
  API->>BANK: Reserve/Capture/Transfer
```

## Component Responsibilities

| Component                | Responsibility                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bank Web App             | Surface delivery status, accept/reject actions, and PayNote details in the transaction/contracts UI (including PayNote indicators on hold/txn details). |
| Bank API                 | Receive MyOS webhooks, resolve document ids, call MyOS operations, expose UI-facing delivery/PayNote endpoints.                                         |
| PayNote Delivery Service | Validate participant/channel fields, identify transaction/client from `cardTransactionDetails`, dedupe by `documentId`, link bootstraps.                |
| Banking Facade           | Disable capture and bootstrap the PayNote on client acceptance.                                                                                         |
| MyOS Client              | Fetch events/documents and execute document operations in MyOS sandbox.                                                                                 |
| DynamoDB                 | Store PayNote Delivery docs, PayNote docs keyed by `documentId`, hold metadata for PayNote linkage, and bootstrap session mappings.                     |

## Technology & Frameworks

| Layer          | Choice                                           | Rationale                                                         |
| -------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| API            | ts-rest on AWS Lambda                            | Aligns with existing bank API stack.                              |
| Storage        | DynamoDB single table                            | Reuse existing persistence model for demo.                        |
| MyOS           | HTTP API (sandbox env)                           | Required for PayNote Delivery sessions and webhooks.              |
| Blue Documents | `@blue-labs/language` + `@blue-repository/types` | Type-safe parsing, validation, and serialization of PayNote docs. |
| UI             | React                                            | Reuse existing bank web app patterns for PayNote details.         |

## Cost Estimation

| Item                 | Monthly Cost (USD) | Source                               |
| -------------------- | ------------------ | ------------------------------------ |
| Lambda + API Gateway | 0 (existing usage) | Reuse current serverless stack       |
| DynamoDB storage     | 0 (existing usage) | Incremental PayNote docs are minimal |
| MyOS sandbox API     | 0 (dev env)        | Provided sandbox environment         |

## Security Review

| Vector               | Mitigation                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Webhook authenticity | Not implemented in current bank webhook handler (route excluded from auth middleware); can be enabled outside local environments if added later. |
| Data exposure        | Store only PayNote Delivery + PayNote docs and `cardTransactionDetails` (no PAN).                                                                |
| Access control       | Only identified deliveries are surfaced to the mapped client.                                                                                    |
| Document integrity   | Validate participant/channel fields and Blue document types before acting.                                                                       |
| Transport            | TLS for all MyOS API calls and webhook delivery.                                                                                                 |

## Risks & Mitigations

- Webhook duplicates/out-of-order events may re-trigger operations; enforce idempotency by event id/session id.
- PayNote Delivery bootstrap is async; `DOCUMENT_CREATED` arrives for both deliverer and receiver sessions, so deduplicate using `documentId` (fallback to `cardTransactionDetails`).
- PayNote bootstrap mapping depends on `Target Document Session Started`; if missing, delivery ↔ PayNote linkage may be delayed.
- Transaction identification may fail due to missing/mismatched `cardTransactionDetails`; report failure and keep delivery hidden.
- Webhook payload shape differences could break parsing; HTTP webhooks include full payloads, but minimal/SQS deliveries must fetch events via MyOS APIs.
- Local webhook forwarding reliability could block E2E; document forwarding setup and allow event replay.

## Open Questions

- None for this phase.
