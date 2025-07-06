# 006 Simplified Core Banking – Internal‑Only Transfers & Funding

## Status

- 2025-07-05 Accepted

## Context

For the first demo milestone we only need **USD**, **internal transactions**, and the ability to **fund** an account with play money.  
We want:

- **Immutability & double‑entry** integrity,
- **Low operational cost** and frictionless LocalStack DX,
- A clear path to holds, suspense accounts and external rails later.

A **single DynamoDB table** with synchronous balance snapshots satisfies those drivers.

## Decisions

| #   | Decision                                                                                                                                                                            | Rationale                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | **Single‑Table DynamoDB** (`BankTable`) stores `Account`, `BalanceSnapshot`, `TxnHeader`, `Posting`, `IdempotencyGuard`.                                                            | One service to learn, identical behaviour on LocalStack, cost pennies.      |
| 2   | **Append‑Only Postings**; `TxnHeader.status` may mutate (`PENDING`, `POSTED`, `VOID`, `RETURNED`).                                                                                  | Money trail stays immutable; UI can show lifecycle.                         |
| 3   | **Snapshot Updated Synchronously** inside the same `TransactWriteItems`.                                                                                                            | Client gets final balance in the 201 response; simpler than async for demo. |
| 4   | **`FUNDING` Transaction Type**                                                                                                                                                      | Lets demo users mint balance.                                               |
| 5   | **Ephemeral Test Data via TTL** – JWT may carry `isTest=true`; repository sets `ttl` ≤ 24 h on all items.                                                                           | Aligned with current approach to e2e test data                              |
| 6   | **GSI Attribute Names** – Use explicit attribute names: `BANKING_GSI1PK`, `BANKING_GSI1SK`, `BANKING_GSI2PK`, `BANKING_GSI2SK`, `BANKING_GSI3PK`, `BANKING_GSI3SK` for all indexes. | Ensures schema and code are always in sync.                                 |

Detailed design outlined in [004-core-banking-design.md](../design/004-core-banking-design.md)

## Consequences

**Pros**

- Minimal AWS footprint
- Deterministic read‑after‑write UX
- No schema change needed for future async projection
- Built‑in hooks for holds & external rails

**Cons**

- Snapshot update adds a few ms; acceptable at p95 ≤ 1 s under demo load
- Hot partition possible with extremely chatty account; sharding playbook mitigates

## Future Evolution

| Stage                | Change                                                                                               | Impact                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Async Projection** | Enable Stream → Balance Projector Lambda, disable in‑txn snapshot updates                            | Zero schema change; clients receive optimistic balance + WS confirmation |
| **Card Holds**       | Add `PlaceHold` Command; ledger account class `HOLD`; snapshot subtracts hold balance from available | Table schema untouched                                                   |
| **External Rails**   | Commands post to suspense/nostro accounts; clearing workers write settlement or return transactions  | Data model already anticipates these accounts                            |
