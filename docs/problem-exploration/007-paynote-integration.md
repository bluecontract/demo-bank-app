# Problem Exploration - PayNote Integration (Demo Bank)

## Date

2026-01-14

## Context

We want the demo to demonstrate a full PayNote Delivery flow across the card
processor, MyOS, and the bank. This doc focuses on the **demo bank** side:
bootstrapping PayNote Delivery documents, handling webhook-driven updates, and
enabling the client decision flow in the bank UI. The bank already supports
PayNotes uploaded by a client for money transfers; most of the delivery-focused
flow is new work.

The bank acts as the deliverer/issuer and is a participant in the Synchrony
Merchant document session. It receives its own MyOS webhooks for that session
and inspects `DOCUMENT_EPOCH_ADVANCED` payloads to detect
`PayNote Delivery Bootstrap Requested` events. The bank only bootstraps a
delivery when it verifies itself as a participant in the referenced
PayNote Delivery document. The bank also expects specific channel fields to be
unset so it can set them to its own MyOS account id and map the client
internally.

## Stakeholders & Personas

- Bank client (customer) — receives the PayNote and makes the accept/reject decision.
- Bank operator / support — reviews delivery status and resolves issues.
- Demo evaluator / integration developer — needs a reliable, testable end-to-end flow using dev MyOS.

## Scope / Use-Case Scenarios

1. Bank receives `DOCUMENT_EPOCH_ADVANCED` for its Synchrony Merchant session,
   inspects emitted events, and detects `PayNote Delivery Bootstrap Requested`.
2. Bank verifies it is a participant in the referenced PayNote Delivery
   document; if not, it rejects the request and does not bootstrap.
3. Bank validates the delivery + embedded PayNote channel fields:
   - In PayNote Delivery, all channels are set except `payNoteDeliverer` and
     `payNoteReceiver`.
   - In the PayNote, `guarantorChannel` and `payerChannel` are unset.
     The bank fills these channels with its own MyOS account id and treats the
     actual receiver/payer as internal bank clients mapped from card transaction
     details.
4. On a valid request, bank bootstraps the PayNote Delivery in MyOS using the
   existing PayNote bootstrap patterns.
5. Bank receives `DOCUMENT_CREATED` and `DOCUMENT_EPOCH_ADVANCED` for the
   PayNote Delivery, loads the full payload, and attempts to identify the
   related transaction + client using `cardTransactionDetails`.
6. Bank reports transaction identification success/failure via the delivery
   operation; only identified deliveries are shown for client decision.
7. Bank UI surfaces delivery status and lets the client accept or reject it via
   delivery operations.
8. On accept, the bank disables capture for the related transaction and
   bootstraps the PayNote in MyOS; on reject, it records the decision and
   leaves the transaction as-is.
9. Bank stores the PayNote on `DOCUMENT_CREATED` and updates it via
   `DOCUMENT_EPOCH_ADVANCED`, showing it linked to the card transaction and in a
   dedicated contracts view.
10. Local dev flow routes MyOS webhooks from sandbox into localhost for true E2E
    testing.

## Constraints & Assumptions

- Assume webhook forwarding from MyOS dev env into localhost is available for
  local E2E testing.
- Webhooks from the MyOS sandbox are expected to include full event payloads;
  verify the payload/headers in the MyOS docs/tests. If only an event id is
  provided (e.g. minimal webhook), handlers must fetch full payloads.
- PayNote Delivery operations are one-shot and ordered (identify before decision).
- The bank needs a stable mapping from PayNote Delivery to the related card
  transaction; `cardTransactionDetails` from the auth/capture flow are used as
  the canonical key for that linkage.
