# Design - Document Bootstrap Requested (PayNote Delivery + PayNote)

## Date

2026-01-21

## Goal

Handle `Conversation/Document Bootstrap Requested` events in the bank webhook pipeline and bootstrap supported documents (PayNote Delivery, PayNote) using `channelBindings` plus bank-provided bindings, while enforcing assignment via `bootstrapAssignee`.

## High-Level Flow

1. MyOS sends a webhook (`DOCUMENT_CREATED` / `DOCUMENT_EPOCH_ADVANCED`).
2. Bank webhook handler fetches or receives the full payload.
3. Bank scans `object.emitted` for `Conversation/Document Bootstrap Requested`.
4. For each request:
   - Validate assignment (`bootstrapAssignee` resolves to a channel in the requesting document bound to the bank’s MyOS account id).
   - Validate the requested document type.
   - Merge `channelBindings` with bank bindings.
   - Attach `synchronyMerchantLink` where applicable.
   - Call MyOS `POST /documents/bootstrap`.
   - Persist delivery/bootstrap metadata for later linking.

## Assignment Validation

`bootstrapAssignee` is a **channel key** in the requesting document (the document emitting the request). The bank:

- Looks up that channel in the requesting document’s `contracts`.
- Resolves its `accountId` (via the Timeline Channel contract value).
- Ignores the bootstrap request if the resolved `accountId` is not the bank’s MyOS `accountId`.

This prevents the bank from bootstrapping documents intended for other participants.

## Bootstrap Handling by Requested Type

### PayNote Delivery bootstrap

Input:

- Requesting document: Synchrony Merchant session document.
- Bootstrap request: `Conversation/Document Bootstrap Requested`
  - `document`: `PayNote/PayNote Delivery`
  - `channelBindings`: includes processor-provided bindings (e.g., `payNoteSender`)
  - `bootstrapAssignee`: `synchronyChannel`

Bank behavior:

- Attach `contracts.links.synchronyMerchantLink` to the delivery document:
  - `sessionId`: Synchrony Merchant session id
  - `anchor`: `payNoteDeliveries`
- Extend `channelBindings` with bank bindings:
  - `payNoteDeliverer` → bank MyOS `accountId`
  - `payNoteReceiver` → bank MyOS `accountId`
- Bootstrap the delivery document via MyOS.
- Upsert delivery record keyed by `cardTransactionDetails`.

### PayNote bootstrap (from accepted delivery)

Input:

- Requesting document: PayNote Delivery session document.
- Bootstrap request: the delivery’s embedded `payNoteBootstrapRequest`
  - `document`: `PayNote/PayNote`
  - `channelBindings`: includes processor-provided bindings (e.g., `cardProcessorChannel`)
  - `bootstrapAssignee`: `payNoteDeliverer`

Bank behavior:

- Resolve Synchrony Merchant session id from the delivery’s `synchronyMerchantLink`.
- Attach `contracts.links.synchronyMerchantLink` to the PayNote document:
  - `sessionId`: Synchrony Merchant session id
  - `anchor`: `payNotes`
- Extend `channelBindings` with bank bindings:
  - `payerChannel` → bank MyOS `accountId`
  - `guarantorChannel` → bank MyOS `accountId`
- Bootstrap the PayNote via MyOS.
- Update the delivery record with `payNoteBootstrapRequestedAt` and (if returned) `payNoteBootstrapSessionId`.

## Implementation Notes (Demo Bank)

- Webhook classification treats `Conversation/Document Bootstrap Requested` as a delivery-related trigger to ensure the delivery handler runs even when the `object.document` is not a PayNote Delivery (e.g., Synchrony Merchant).
- The bank no longer bootstraps the PayNote directly inside the “accept” API operation; acceptance emits a bootstrap request which is handled consistently via the webhook pipeline.
- Legacy PayNote Delivery bootstrap events can be supported as a fallback, but new behavior should prefer `Conversation/Document Bootstrap Requested`.
