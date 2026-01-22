# Research - Contracts UI & Document Display (Current Implementation)

## Date

2026-01-20

## Why this exists

Before replacing the raw JSON/YAML document panel with an LLM-generated summary, we need a clear picture of:

- What the Demo Bank Contracts UI currently renders.
- What data the Bank API provides for a contract.
- Where “current state” lives (status + timestamps + stored document content).
- Where a summary could be produced (backend vs frontend) and how it would fit.

## Current UX (Demo Bank Web App)

The Contracts view is implemented as a list + details split pane:

- Contracts page: `demo-bank-app/apps/bank-web-app/src/pages/ContractsPage/index.tsx`
- Details panel: `demo-bank-app/apps/bank-web-app/src/features/contracts/components/ContractDetailsPanel.tsx`

The details panel currently shows:

- Contract header: display name, session id, document id, status, updated time.
- Status timeline: `statusTimestamps` rendered as key/value timestamps.
- **Contract document (raw)**: a YAML dump of the stored contract document JSON.
- Available operations: root `Conversation/Operation` contracts filtered by a configured channel key.
- Operation invocation UI: dynamic request form + confirmation step.
- Related activity: linked transactions/holds (via IDs).

### “Raw document” rendering today

The document panel is currently a YAML view of the stored JSON document, with a Blue inline-type restoration attempt:

- `restoreInlineTypes()` uses `blue.jsonValueToNode` → `blue.reverse` → `blue.restoreInlineTypes` → `blue.nodeToJson`.
- Then `js-yaml` is used for display (`yamlDump`).

This panel is the primary replacement target for an LLM summary (with a fallback path to view raw YAML).

## Current data model (Bank API contract details)

The API response shape is defined in:

- `demo-bank-app/libs/shared/bank-api-contract/src/lib/schemas.ts` (`ContractDetailsDto`)
- `demo-bank-app/libs/shared/bank-api-contract/src/lib/bank-api-contract.ts` (`GET /v1/contracts/:sessionId`)

`ContractDetailsDto` currently includes (high-level):

- Identification: `contractId`, `typeBlueId`, `displayName`, `sessionId`, `documentId`
- State: `status`, `statusUpdatedAt`, `statusTimestamps`
- Traceability: `triggerEvent`, `emittedEvents`
- Banking linkage: `relatedTransactionIds`, `relatedHoldIds`, `accountNumber`
- Content: `document` (the stored document JSON)
- Bookkeeping: `createdAt`, `updatedAt`

The handler currently returns `document` and status fields, but does not yet populate `triggerEvent` / `emittedEvents`:

- `demo-bank-app/apps/bank-api/src/contracts/getContractDetails.ts`

## Operation discovery (what “available actions” means)

The UI collects operations from the root `contracts` map on the stored document:

- `demo-bank-app/apps/bank-web-app/src/features/contracts/lib/operations.ts`

Key behaviors:

- Parses `document` to a Blue node and reads only root `contracts`.
- Selects contracts typed as `Conversation/Operation` via `OperationSchema` (with `checkSchemaExtensions: true`).
- Filters operations by `operation.channel === operationsChannelKey`.
- If `operation.channel` is missing, the operation is not shown.

### Supported-contract registry

Both backend and frontend rely on an explicit supported-contract registry:

- `demo-bank-app/libs/shared/bank-api-contract/src/lib/supportedContracts.ts`

It provides:

- Contract type matching (by type BlueId and by schema type checks).
- `displayName` mapping (strip `PayNote/` prefix).
- The per-type `operationsChannelKey` used for operation filtering in the UI.

Note: the registry currently configures PayNote Delivery `operationsChannelKey` as `payNoteDeliverer`, while earlier design docs reference `payNoteReceiver`. If the underlying PayNote Delivery contract’s `Conversation/Operation.channel` is `payNoteReceiver` (as in `blue-repository/PayNote/PayNoteDelivery.dev.blue`), this mismatch will cause the Contracts UI to show zero operations for that type.

## Implications for an LLM “document summary”

Where the summary can be generated:

- **Backend-generated (recommended for secrets + caching)**: add summary generation to Bank API (or contracts lib) and return it in `ContractDetailsDto` (or a dedicated endpoint).
- **Frontend-generated (not recommended)**: would require exposing API keys in the browser or proxying via another backend endpoint anyway.

What “current state” means in this view:

- The Bank API already stores derived state: `status`, `statusUpdatedAt`, `statusTimestamps`.
- The stored `document` is the authoritative current document snapshot (as last persisted by webhooks/bootstrap handling).
- The UI also derives “available operations” (root contracts filtered by channel key).

The Contracts details page has a natural home for a summary:

- Replace the “Contract document” YAML panel with a “Summary” panel.
- Keep raw YAML behind a toggle (developer/operator escape hatch + validation/debug).
