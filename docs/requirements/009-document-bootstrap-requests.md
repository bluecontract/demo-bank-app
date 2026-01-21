# Requirements - Document Bootstrap Requested (PayNote Delivery + PayNote)

## Date

2026-01-21

## Summary

Demo Bank must handle `Conversation/Document Bootstrap Requested` events emitted by MyOS documents to bootstrap PayNote Delivery and PayNote documents, using `channelBindings` instead of mutating contracts with `accountId`s.

## Functional Requirements

|   ID | Requirement                                                                                                                                                                                                            | Priority |
| ---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------: |
| FR-1 | Detect `Conversation/Document Bootstrap Requested` in MyOS webhook `object.emitted` payloads.                                                                                                                          |   Must   |
| FR-2 | Validate `bootstrapAssignee` is present and refers to a participant channel in the _requesting document_ whose `accountId` matches the bank’s MyOS `accountId`. If it does not match, **ignore** the request.          |   Must   |
| FR-3 | For requests whose `document` is a `PayNote/PayNote Delivery`: bootstrap the provided document in MyOS using a merged `channelBindings` (processor-provided + bank-provided).                                          |   Must   |
| FR-4 | For requests whose `document` is a `PayNote/PayNote`: bootstrap the provided document in MyOS using a merged `channelBindings` (processor-provided + bank-provided).                                                   |   Must   |
| FR-5 | Reject (log and do not bootstrap) `Conversation/Document Bootstrap Requested` whose `document` is not a supported type.                                                                                                |   Must   |
| FR-6 | Do not inject participant `accountId` values directly into document contract channels during bootstrap handling; instead use `channelBindings`. (Non-participant metadata such as `synchronyMerchantLink` is allowed.) |   Must   |
| FR-7 | When bootstrapping a PayNote Delivery, attach `contracts.links.synchronyMerchantLink` pointing to the Synchrony Merchant session and the `payNoteDeliveries` anchor.                                                   |   Must   |
| FR-8 | When bootstrapping a PayNote, attach `contracts.links.synchronyMerchantLink` pointing to the Synchrony Merchant session and the `payNotes` anchor.                                                                     |   Must   |
| FR-9 | Persist delivery/paynote bootstrap context needed for downstream linking: `payNoteBootstrapRequestedAt` and (when available) `payNoteBootstrapSessionId`.                                                              |  Should  |

## Non-Functional Requirements

|    ID | Requirement                                                                                                       | Priority |
| ----: | ----------------------------------------------------------------------------------------------------------------- | :------: |
| NFR-1 | Webhook processing must be idempotent per MyOS event id.                                                          |   Must   |
| NFR-2 | Log outcomes for bootstrap requests: ignored (not assigned), rejected (unsupported), attempted, succeeded/failed. |   Must   |
| NFR-3 | Handle schema/shape drift defensively (missing fields, value wrappers) without crashing the webhook handler.      |   Must   |
