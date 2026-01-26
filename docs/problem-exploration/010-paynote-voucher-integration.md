# Problem Exploration - PayNote Voucher Integration (Demo Bank)

## Date

2026-01-26

## Repository Placement

- Target path: `docs/problem-exploration/011-paynote-voucher-integration.md`

## Context

The demo bank already implements:

- Card issuing and card transaction processing (authorization hold + capture posting).
- PayNote Delivery ingestion and client decisioning in the bank UI.
- PayNote bootstrapping and document operation execution through MyOS, driven by webhooks.

We now want to extend the demo to support **Voucher-based cashback** offered through the PayNote flow.

At a high level:

1. A merchant proposes a PayNote for a card transaction (via PayNote Delivery).
2. After the client accepts, the PayNote chain bootstraps a **Voucher** contract (`PayNote/PayNote Voucher`).
3. The client activates the voucher (consent).
4. The voucher explicitly requests the bank to start **monitoring card transactions** for a specific `targetMerchantId` and reporting them into the voucher document.
5. For each eligible captured card purchase at the target merchant, the voucher requests a cashback transfer from the voucher issuer merchant to the client until a fixed limit is reached (this iteration: **100% cashback up to `limitMinor`**).

The bank is responsible for both:

- **MyOS orchestration** (bootstrap, webhook handling, operation calls), and
- **fund movement** in the demo bank ledger (holds, transfers, partial capture).

## Assumed Blue Types (treated as existing for this repo)

- `PayNote/PayNote Voucher`
- `PayNote/Start Card Transaction Monitoring Requested`
- `PayNote/Card Transaction Monitoring Started`
- `PayNote/Card Transaction Monitoring Request Rejected`
- `PayNote/Card Transaction Report`
- `PayNote/Eligible Card Transaction Reported`
- `PayNote/Ineligible Card Transaction Reported`
- `PayNote/Reserve Funds Requested`
- `PayNote/Capture Funds Requested`
- `Conversation/Document Bootstrap Requested`

**Time fields:** Any `*At` fields in these types use conventional names (e.g., `requestedAt`, `occurredAt`) and are represented as **Integer microseconds since epoch** for now (type upgrade later, field names unchanged).

## Critical MyOS Constraint: Bootstrap Is a Two-Step Process

MyOS bootstrapping is a two-step lifecycle:

1. The bank calls `bootstrapDocument(...)` in response to a `Conversation/Document Bootstrap Requested` event.
2. The API returns **only the bootstrap tracking session/document** (`DocumentSessionBootstrap`) — not the target contract session/document.
3. The bank must discover the **target document session(s)** by:
   - listening to webhook updates (`DOCUMENT_EPOCH_ADVANCED`) on the bootstrap session and parsing `TargetDocumentSessionStarted`, and/or
   - optionally listening for `DOCUMENT_CREATED` and inspecting the created document.

The existing PayNote flow in the bank already follows this pattern for PayNote. Voucher must align to the same mechanism.

### Why this matters for Voucher

- Voucher bootstrap must not assume the `bootstrapDocument(...)` response identifies the voucher session/document.
- The bank needs a durable mapping: `bootstrapSessionId -> (request context)` so that when the bootstrap session advances, it can finalize the mapping to the created voucher session/document.

## Stakeholders & Personas

- **Bank client (customer)**: receives the voucher, activates it (consent), and pays at the target merchant.
- **Voucher issuer merchant**: funds cashback payments (in demo: via a bank credit line account).
- **Bank operator / demo evaluator**: needs a reliable E2E flow and clear correlation between transactions and contracts.
- **Future**: partnership/agent flows (out of scope for voucher MVP), but voucher should not block that evolution.

## Scope / Use-Case Scenarios (Bank-side)

### Scenario A — Merchant identity + credit line funding account

1. A merchant signs up in the bank app with an external `merchantId` (processor `userId`).
2. The bank automatically creates a **CREDIT_LINE** account for that merchant.
3. The merchant can adjust the credit limit in UI (demo convenience).

### Scenario B — Voucher creation and activation (with 2-step bootstrap)

1. Bank receives PayNote Delivery + PayNote webhooks (existing flow).
2. A PayNote emits `Conversation/Document Bootstrap Requested` for a Voucher document.
3. Bank calls `bootstrapDocument(...)` and receives `voucherBootstrapSessionId` (bootstrap tracking session).
4. Bank stores a mapping from `voucherBootstrapSessionId` to context (e.g., userId, rootTransactionId, requester paynote session/document).
5. Bank listens to bootstrap session webhooks; upon `TargetDocumentSessionStarted`, it fetches the target document and persists the voucher contract record, linking it to the root transaction.
6. Client opens voucher in bank UI and runs `activateVoucher`.
7. Voucher emits:

   - `PayNote/Reserve Funds Requested` for `limitMinor`, and
   - `PayNote/Start Card Transaction Monitoring Requested` specifying `targetMerchantId` and `reportOperationName`.

8. Bank reserves funds from the issuer merchant credit line account (hold), registers a monitoring subscription, and confirms monitoring started (or rejects with reason).

### Scenario C — Monitoring, reporting, cashback payout

1. Client makes a card purchase at the target merchant.
2. On capture/posting, bank looks up active monitoring subscriptions for `(client, merchantId)`.
3. Bank calls `runDocumentOperation` on the voucher session:

   - operation: `reportCardTransaction`
   - request: `PayNote/Card Transaction Report` (includes unique `transactionId`)

4. Voucher deduplicates by `transactionId`, emits eligible/ineligible events, and when eligible emits `PayNote/Capture Funds Requested` referencing the purchase `transactionId`.
5. Bank processes capture request by **partial capturing** from the voucher funding hold and crediting the client account used for the purchase.
6. Bank persists relationships so that:
   - transaction view shows related contracts (delivery/paynote/voucher),
   - voucher view shows related transactions/hold(s).

## Constraints / Assumptions

- The bank is the only party able to call MyOS operations in this demo (proxy model).
- The processor must provide a stable external `merchantId` in card requests; bank persists it on holds/transactions.
- The bank cannot execute merchant-side MyOS operations because the merchant has its own MyOS account/session not owned by the bank. Merchant views of vouchers should be read-only (or hidden) in this iteration.
- Webhook deliveries may be duplicated; bank-side processing must be idempotent by MyOS event id.
- Bank calls into voucher for reporting may be duplicated; voucher must dedupe by `transactionId`.
- Bootstrap webhook events must not be “consumed” by the wrong handler (see below).

## Key Design Tension: Bootstrap Webhook Idempotency Across Multiple Contract Types

Today the bank has PayNote-specific bootstrap processing. With voucher bootstrap added, we will receive bootstrap session updates for both PayNote and Voucher.

We must ensure:

- PayNote bootstrap handler does **not** mark a bootstrap webhook event processed unless it recognizes (claims) the bootstrap session id.
- Voucher bootstrap handler must do the same.
- Alternatively, implement a shared “bootstrap dispatcher” that:
  - parses bootstrap session id and target session(s),
  - identifies which contract type owns that bootstrap session id via repositories,
  - then performs target resolution and only then marks the webhook event processed.

## Out of Scope (This Iteration)

- Partnership document implementation and settlement logic.
- Consent revocation and reversal/refunds of voucher payouts.
- Historical backfill of purchases before activation.
- Multi-merchant targeting and category rules.
- Fraud/risk controls beyond basic validations/idempotency.

## Open Questions

- If multiple active monitoring subscriptions match the same `(client, merchantId)` purchase, should the bank report to all matching documents or cap to one?
- What is the desired behavior when voucher funding (reserve) fails (reject activation vs remain pending)?
- Do we want a bank → voucher “cashback settled” confirmation operation in v1, or is the bank ledger sufficient for settlement truth?
