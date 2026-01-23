# Problem Exploration - Document Bootstrap Requested (PayNote Delivery + PayNote)

## Date

2026-01-21

## Context

The PayNote delivery flow now uses `Conversation/Document Bootstrap Requested` as the single “bootstrap intent” signal instead of emitting PayNote-specific bootstrap events.

Two related upstream changes drive the update:

- **Synchrony Merchant document** (`SynchronyMerchant.yaml`): `sendPayNote` emits a `Conversation/Document Bootstrap Requested` whose `document` is a `PayNote/PayNote Delivery`.
- **PayNote Delivery document** (`PayNote/PayNote Delivery`): embeds a `payNoteBootstrapRequest` (also `Conversation/Document Bootstrap Requested`) which contains the PayNote proposal. When the client accepts the delivery, the delivery workflow emits this embedded request.

The flow also shifts responsibility for participant binding:

- Processor supplies **mappings** via `channelBindings` (e.g., merchant sender, processor channel).
- Bank supplies its own mappings (e.g., deliverer/receiver channels) by **extending** `channelBindings`.
- Both parties avoid injecting `accountId`s directly into document contracts; `channelBindings` is the source of truth for bootstrap bindings.

Finally, the processor attaches `synchronyMerchantLink` into:

- PayNote Delivery documents (anchor: `payNoteDeliveries`)
- PayNote documents (anchor: `payNotes`)

The bank only knows its own participant session id for the Synchrony Merchant document; the processor already knows the merchant-facing Synchrony Merchant session id and therefore is responsible for setting `synchronyMerchantLink.sessionId` correctly.

## Scenarios

1. **Bootstrapping PayNote Delivery**

   - Processor calls `sendPayNote` on a Synchrony Merchant session.
   - Synchrony Merchant emits `Conversation/Document Bootstrap Requested` with `document: PayNote/PayNote Delivery`.
   - Bank receives webhook, validates assignment, and bootstraps the delivery document in MyOS.

2. **Bootstrapping PayNote after acceptance**

   - Bank UI calls `acceptPayNote` on the PayNote Delivery session.
   - Delivery workflow emits `payNoteBootstrapRequest` (a `Conversation/Document Bootstrap Requested`) for the embedded PayNote proposal.
   - Bank receives webhook, validates assignment, and bootstraps the PayNote document in MyOS.

3. **Ignore mis-assigned requests**

   - If `bootstrapAssignee` points to a channel that is _not_ bound to the bank’s MyOS account, the bank ignores the request.

4. **Reject unsupported requested document types**
   - The bank only bootstraps supported document types (initially PayNote Delivery and PayNote). Any other `document` type in a bootstrap request is rejected (logged, no bootstrap performed).

## Key Problems Solved

- Replaces bespoke “bootstrap requested” events with a single request type (`Conversation/Document Bootstrap Requested`).
- Makes bootstrap responsibility explicit via `bootstrapAssignee` and prevents unintended bootstrapping.
- Moves participant binding out of contracts and into `channelBindings`, reducing mutation and clarifying ownership.
- Centralizes `synchronyMerchantLink` responsibility in the processor (which knows the merchant-facing Synchrony Merchant session id) for both delivery and paynote documents.
