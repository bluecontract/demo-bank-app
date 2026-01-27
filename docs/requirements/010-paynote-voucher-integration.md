# Requirements Specification - PayNote Voucher Integration (Demo Bank)

## Date

2026-01-26

## Repository Placement

- Target path: `docs/requirements/011-paynote-voucher-integration.md`

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
- `DocumentSessionBootstrap` (bootstrap tracking document type)

Time fields use conventional names (e.g., `requestedAt`, `occurredAt`) and are represented as Integer microseconds since epoch for now.

## Functional Requirements

| ID             | Requirement                                                                                                                                                                                                                                                                                                                                                                                                     | Priority |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-VCH-BANK-1  | Merchant sign-up: The bank sign-up UI supports an “I am a merchant” toggle. When enabled, the sign-up request includes `merchantId`. The backend treats presence of `merchantId` as merchant identity (no required `isMerchant` flag).                                                                                                                                                                          | Must     |
| FR-VCH-BANK-2  | Merchant credit line: On merchant sign-up, bank auto-creates one `CREDIT_LINE` account with a configurable default credit limit.                                                                                                                                                                                                                                                                                | Must     |
| FR-VCH-BANK-3  | Credit limit edit: Merchant can change credit limit in bank UI. The bank enforces invariants so the limit cannot be reduced below already-used credit (posted + reserved).                                                                                                                                                                                                                                      | Must     |
| FR-VCH-BANK-4  | Merchant identity isolation: Bank resolves merchant accounts by `merchantId` via a dedicated resolver boundary so `merchantId == userId` can be replaced later without large refactors.                                                                                                                                                                                                                         | Must     |
| FR-VCH-BANK-5  | Card API accepts merchantId: Bank card-processor endpoints accept a stable `merchantId` (external id) and persist it on authorization holds and posted transactions.                                                                                                                                                                                                                                            | Must     |
| FR-VCH-BANK-6  | Supported contracts allow-list: Bank supports `PayNote/PayNote Voucher` as an allowed document type (in addition to existing PayNote Delivery/PayNote).                                                                                                                                                                                                                                                         | Must     |
| FR-VCH-BANK-7  | Voucher bootstrap request handling: Bank handles `Conversation/Document Bootstrap Requested` for Voucher when assigned to the bank, by calling MyOS `bootstrapDocument(...)`.                                                                                                                                                                                                                                   | Must     |
| FR-VCH-BANK-7a | Two-step bootstrap tracking: The bank must treat MyOS bootstrap as a two-step process. After calling `bootstrapDocument(...)`, the bank must persist `voucherBootstrapSessionId` (bootstrap tracking session id) and later resolve the target voucher session/document by processing webhook updates for the bootstrap session (e.g., `TargetDocumentSessionStarted`) and fetching the target document content. | Must     |
| FR-VCH-BANK-7b | Bootstrap dispatcher safety: The bank must not mark bootstrap webhook events processed unless the handler recognizes (claims) the bootstrap session id as one it owns. This prevents PayNote bootstrap logic from consuming Voucher bootstrap events (and vice versa).                                                                                                                                          | Must     |
| FR-VCH-BANK-8  | Correlation: Bank persists many-to-many relations so (a) transaction view shows related contracts, and (b) contract view shows related transactions and holds. V1 treats relationships as append-only; if relations can shrink later, reverse-index deletions are required to avoid stale links.                                                                                                                | Must     |
| FR-VCH-BANK-9  | Monitoring request handling: When bank observes `PayNote/Start Card Transaction Monitoring Requested` emitted by a supported contract, it validates the request and either confirms start (`PayNote/Card Transaction Monitoring Started`) or rejects (`PayNote/Card Transaction Monitoring Request Rejected` with `reason`).                                                                                    | Must     |
| FR-VCH-BANK-10 | Monitoring registry is generic: Bank stores monitoring subscriptions in a generic mechanism (not voucher-specific). Subscription matching is by `(client identity, targetMerchantId)` (v1).                                                                                                                                                                                                                     | Must     |
| FR-VCH-BANK-11 | Operation allow-list: Bank must not call arbitrary operation names from untrusted documents. For voucher, only the expected report op (e.g., `reportCardTransaction`) is allowed.                                                                                                                                                                                                                               | Must     |
| FR-VCH-BANK-12 | Reporting hook: On card capture/posting, bank looks up active monitoring subscriptions for `(client, merchantId)` and calls `runDocumentOperation` on each matching document session with `PayNote/Card Transaction Report`.                                                                                                                                                                                    | Must     |
| FR-VCH-BANK-13 | Report payload uniqueness: Bank uses the posted purchase `transactionId` as the unique idempotency key in the report payload.                                                                                                                                                                                                                                                                                   | Must     |
| FR-VCH-BANK-14 | Voucher reserve handling: When voucher emits `PayNote/Reserve Funds Requested`, bank creates a hold for the full voucher limit on the issuer merchant credit line account. Holds must use a unique hold id (not derived from voucher document id).                                                                                                                                                              | Must     |
| FR-VCH-BANK-15 | Partial capture: Bank supports partial capture against a hold so multiple cashback payouts can occur until the voucher limit is exhausted.                                                                                                                                                                                                                                                                      | Must     |
| FR-VCH-BANK-16 | Voucher capture handling: When voucher emits `PayNote/Capture Funds Requested`, bank performs an idempotent partial capture payout from issuer merchant to the client account used for the referenced purchase `transactionId`.                                                                                                                                                                                 | Must     |
| FR-VCH-BANK-17 | Bank-side idempotency: Voucher payout processing must be idempotent per `(voucherDocumentId, purchaseTransactionId)`.                                                                                                                                                                                                                                                                                           | Must     |
| FR-VCH-BANK-18 | Merchant voucher visibility: If merchants can log in to the bank UI, vouchers may be shown read-only (no merchant-channel operations), or hidden entirely.                                                                                                                                                                                                                                                      | Should   |
| FR-VCH-BANK-19 | Observability: Logs/metrics include voucher session/document id, issuer merchantId, target merchantId, and purchase transactionId.                                                                                                                                                                                                                                                                              | Should   |

## Non-Functional Requirements

| ID             | Category        | Requirement                                                                                                              | Metric/Target        |
| -------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| NFR-VCH-BANK-1 | Integrity       | Webhook processing is idempotent by MyOS event id; payout is idempotent by `(voucherDocumentId, purchaseTransactionId)`. | 0 duplicate payouts  |
| NFR-VCH-BANK-2 | Performance     | Monitoring lookup during capture must not require scanning all contracts; use indexed access by `(client, merchantId)`.  | O(1)–O(log n)        |
| NFR-VCH-BANK-3 | Compatibility   | Existing PayNote Delivery / PayNote flows keep working (no regressions).                                                 | No E2E break         |
| NFR-VCH-BANK-4 | Security (demo) | No PAN stored/returned in voucher flow; only identifiers and amounts.                                                    | No PAN leakage       |
| NFR-VCH-BANK-5 | Dev/Test        | E2E can run against sandbox MyOS with webhook forwarding into localhost.                                                 | Repeatable local run |

## Acceptance Criteria

- A merchant can sign up with `merchantId`; bank creates a CREDIT_LINE account with default limit and allows editing.
- Card authorization/capture requests include `merchantId`, and the bank stores it on holds and posted transactions.
- Voucher bootstrap is handled via a two-step MyOS bootstrap:
  - the bank stores the voucher bootstrap session id,
  - resolves the created voucher session/document via bootstrap session webhook updates,
  - fetches the target document content and persists it.
- Bootstrap webhook events are not consumed by the wrong handler.
- Voucher documents can be bootstrapped, stored, and linked to the initiating transaction chain.
- Client activates voucher; bank reserves funds and registers monitoring, then confirms monitoring started (or rejects with a reason).
- A captured purchase at the target merchant triggers a report into the voucher session, and voucher capture requests trigger an idempotent partial capture payout.
- Transaction details UI shows related contracts; contract details UI shows related transactions/holds.
