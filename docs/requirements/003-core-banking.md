# Requirements Specification – Core Banking (Accounts & Internal Transfers)

## Date

2025-07-05

## Functional Requirements

| ID       | Requirement                                                                                                                                                                                                  | Priority |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| FR-ACC-1 | **Create Account** – A signed‑in user can create multiple bank accounts; system generates `accountId` (UUID) and a **10‑digit account number** unique across demo.                                           | Must     |
| FR-ACC-2 | **Fund Account** – In the _Funding_ UI a user enters an _amount_ (positive integer ≤ 1,000,000) which results in a **credit** transaction of type `FUNDING`.                                                 | Must     |
| FR-ACC-3 | **Internal Transfer** – User can send money to another valid **account number** in the demo. Amount must be ≤ _available balance_.                                                                           | Must     |
| FR-ACC-4 | **Validation** – Transfer fails with clear error when: destination account unknown, amount ≤ 0, or insufficient available balance.                                                                           | Must     |
| FR-ACC-5 | **Transaction List** – User can list their last N transactions with: date, type, counter‑party, amount (signed), status, resulting balance.                                                                  | Must     |
| FR-ACC-6 | **Balance Endpoint** – API returns both `ledgerBalance` and `availableBalance` calculated **synchronously** within the transaction request for deterministic UX.                                             | Must     |
| FR-ACC-7 | **Idempotency** – `CreateTransaction` accepts `Idempotency-Key` header; duplicate keys return the original 201 response.                                                                                     | Must     |
| FR-ACC-8 | **Ephemeral Test Data** – If the authenticated JWT carries `isTest=true`, _every_ DynamoDB item written in that request MUST include a `ttl` ≤ 24 h so data self‑purges; no destructive endpoint is allowed. | Should   |

## Non‑Functional Requirements

| ID        | Category       | Requirement                                                                                             |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| NFR-ACC-1 | Security       | All monetary APIs require authenticated session token.                                                  |
| NFR-ACC-2 | Integrity      | Double‑entry enforced: Σ debits = Σ credits per transaction.                                            |
| NFR-ACC-3 | Performance    | p95 latency ≤ 1 s for `CreateTransaction` under 50 RPS.                                                 |
| NFR-ACC-4 | Availability   | Core banking APIs ≥ 99.5 % up‑time.                                                                     |
| NFR-ACC-5 | Observability  | Each txn emits structured log incl. `txnId`, `initiator`, validation result.                            |
| NFR-ACC-6 | Ephemeral Data | Items marked `isTest` expire automatically (TTL) without interfering with prod data.                    |
| NFR-ACC-7 | Cost           | Added idle AWS cost < $10 month.                                                                        |
| NFR-ACC-8 | Extensibility  | Data model must allow holds, external suspense accounts, multi‑currency without breaking existing APIs. |

## Acceptance Criteria

- User opens an account and sees balance = `0.00 USD`.
- Funding 250.00 increases ledger _and_ available balance by 250.00 and appears in feed as **FUNDING** credit.
- Sending 100.00 to another existing account succeeds; balances update atomically on both accounts; feed shows **TRANSFER** debit / credit.
- Attempting to send 999,999.00 with only 150.00 available returns `400 Insufficient Funds`.
- Attempting to send to non‑existing account returns `404 Destination Not Found`.
- **Test data is always ephemeral if `isTest=true` in JWT; repository enforces TTL on all items.**
