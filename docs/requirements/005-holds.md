# Holds (Funds Reservation) — Requirements

## Functional Requirements

1. **Reserve Funds**

   - Input: `userId`, `idempotencyKey`, `payerAccountNumber`, `amountMinor`, optional `description`, optional `counterpartyAccountNumber`.
   - Preconditions: payer account exists & active; `amountMinor > 0`; currency USD; `availableBalance >= amountMinor`.
   - Effects: create Hold with `status=PENDING`; decrease `availableBalance` by `amountMinor`; write a `CREATED` event; ensure idempotency.

2. **Release Hold**

   - Input: `userId`, `idempotencyKey`, `holdId`, optional `reason`.
   - Preconditions: Hold `status=PENDING`.
   - Effects: set `status=RELEASED`; increase `availableBalance` by hold amount; write `RELEASED` event; idempotent.

3. **Capture Hold**

   - Input: `userId`, `idempotencyKey`, `holdId`, optional `counterpartyAccountNumber`.
   - Preconditions: Hold `status=PENDING`; counterparty known (either stored on hold or provided in command).
   - Effects: atomically
     - mark hold `CAPTURED`,
     - cancel reservation (increase available by hold amount),
     - post normal internal transfer **payer → counterparty** for the same amount, with `originHoldId` set on the transaction,
     - store `relatedTransactionId` on the hold,
     - write `CAPTURED` event,
     - idempotent.

4. **Activity Feed (Read)**
   - **Single endpoint** returning latest account activity as a merged list of `PENDING_HOLD` and `POSTED_TRANSACTION` items in **descending time** order.
   - Cursor‑based pagination that is **stable** across pages and merges two data sources without gaps/duplicates.
   - Limit parameter controls total items (regardless of type).

## Non‑Functional Requirements

- **Atomicity & Concurrency**: reserve/release/capture must be single DynamoDB `TransactWrite` operations with appropriate conditions to avoid races.
- **Idempotency**: per command using existing pattern (`PK=USER#userId`, `SK=IDEMPOTENCY#<hash>`).
- **Auditability**: append‑only hold events (`CREATED`, `RELEASED`, `CAPTURED`, `FAILED`) with ISO timestamps.
- **Performance**: Activity endpoint must serve the latest 20–100 items under typical demo loads without extra materialization.
- **Backwards Compatibility**: no changes required for existing transaction endpoints; ledger semantics unchanged.
- **Security**: no new public write endpoints in this phase.

## Out of Scope (Now)

- Expiry/extension, partial captures, refunds, external rails, PayNotes webhook/bootstrap, customer UI beyond Activity read.

## Terminology

- **Available balance**: current balance minus sum of amounts of all **pending holds**.
- **Ledger/current balance**: balance implied by **posted** transactions only; unaffected by holds.

## Acceptance (High Level)

- Balances move as specified under reserve/release/capture.
- Hold lifecycle persists and is queryable.
- Activity feed returns a correct, ordered mix with stable pagination.
- Commands are idempotent and race‑safe.
