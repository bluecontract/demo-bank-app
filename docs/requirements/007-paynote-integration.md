# Requirements Specification - PayNote Delivery Integration (Demo Bank)

## Date

2026-01-14

## Functional Requirements

| ID       | Requirement                                                                                                                                                                                                                                                                                                                             | Priority |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-PN-1  | Synchrony Merchant Webhooks: The bank receives MyOS webhooks for its Synchrony Merchant session, inspects `DOCUMENT_EPOCH_ADVANCED` payloads, and detects `PayNote Delivery Bootstrap Requested` events containing the PayNote Delivery document under `delivery`.                                                                      | Must     |
| FR-PN-2  | Participant Validation: The bank verifies it is a participant in the referenced PayNote Delivery document; invalid requests are rejected internally, logged, and not bootstrapped.                                                                                                                                                      | Must     |
| FR-PN-3  | Channel Validation + Fill: The bank requires `payNoteDeliverer` and `payNoteReceiver` to be unset in the PayNote Delivery, and `guarantorChannel` and `payerChannel` to be unset in the PayNote; it fills those channels with the bank MyOS account id and treats receiver/payer as internal clients mapped from card transaction data. | Must     |
| FR-PN-4  | Delivery Bootstrap: On valid requests, the bank bootstraps the PayNote Delivery in MyOS using existing PayNote bootstrap patterns and idempotent operation calls.                                                                                                                                                                       | Must     |
| FR-PN-5  | Delivery Webhook Handling: The bank processes `DOCUMENT_CREATED` and `DOCUMENT_EPOCH_ADVANCED` for the PayNote Delivery, persists the full delivery document, and stores metadata needed for UI and audit.                                                                                                                              | Must     |
| FR-PN-6  | Transaction Identification: The bank uses `cardTransactionDetails` from PayNote Delivery document to identify the related transaction + client, links the delivery to internal records on success, and suppresses client visibility on failure.                                                                                         | Must     |
| FR-PN-7  | Identification Reporting: The bank reports identification success/failure via `POST /documents/{sessionId}/{operationName}` on the Synchrony Merchant session (operation `updateTransactionIdentificationStatus`) and enforces one-shot semantics.                                                                                      | Must     |
| FR-PN-8  | Client Decision UI: The bank UI surfaces identified deliveries to the client and allows accept/reject via delivery operations; decisions are allowed only after identification and are one-shot.                                                                                                                                        | Must     |
| FR-PN-9  | Decision Effects: On accept, the bank disables capture for the related card transaction and bootstraps the PayNote; on reject, it records the decision and leaves the transaction unchanged.                                                                                                                                            | Must     |
| FR-PN-10 | PayNote Lifecycle: The bank stores the PayNote on `DOCUMENT_CREATED`, updates it via `DOCUMENT_EPOCH_ADVANCED`, and links it to the card transaction for viewing in transaction details/contracts UI.                                                                                                                                   | Must     |
| FR-PN-11 | Webhook Payload Support: The webhook handler accepts full payloads and, if only an event id is provided, fetches the full payload from the MyOS event API.                                                                                                                                                                              | Should   |

## Non-Functional Requirements

| ID       | Category      | Requirement                                                                                                                              | Metric/Target                     |
| -------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| NFR-PN-1 | Integrity     | Webhook handling and MyOS operations are idempotent by event id/delivery id.                                                             | 0 duplicate state transitions     |
| NFR-PN-2 | Security      | Webhook signature verification is not required for this phase; if added later, it is enforced only outside local environments.           | No local verification requirement |
| NFR-PN-3 | Observability | Logs/metrics include event id, session id, delivery id, payNote id, and transaction identifiers (no sensitive PAN).                      | 100% of webhook requests          |
| NFR-PN-4 | Compatibility | Changes align with existing PayNote bootstrap/webhook contracts and do not break existing PayNote transfer flows.                        | No breaking changes               |
| NFR-PN-5 | Dev/Test      | Local E2E supports sandbox MyOS with webhook forwarding into localhost.                                                                  | Local E2E flow documented         |
| NFR-PN-6 | Compatibility | Blue payloads are handled with the Blue language library (`isTypeOf`, `nodeToSchemaOutput`, `nodeToJson`) to preserve document fidelity. | No schema/type drift              |

## Acceptance Criteria

- When a `PayNote Delivery Bootstrap Requested` event arrives on the Synchrony Merchant session, the bank validates participant/channel fields; invalid requests are rejected internally, logged, and not bootstrapped.
- For valid requests, the bank bootstraps the PayNote Delivery and processes subsequent Delivery webhooks, storing delivery state and linking to the correct transaction/client via `cardTransactionDetails`.
- Identification success is reported once; unidentified deliveries are not visible to the client.
- The client can accept or reject only after identification; accept disables capture and bootstraps the PayNote, reject leaves the transaction unchanged.
- PayNote documents are stored on creation, updated on epoch advances, and visible from the related transaction and contracts view.
- Webhook handlers accept full payloads and fall back to MyOS event fetch when only an event id is provided.
