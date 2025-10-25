# Holds (Funds Reservation) — Design

## Overview

We implement **off‑ledger holds** (encumbrances) that reduce **available balance** but do not create posted ledger entries until **capture**. This keeps the posted ledger clean and matches common banking behavior. The FE will later use a single **Activity** endpoint that merges **pending holds** and **posted transactions** into one ordered list.

---

## Domain Model

### Entities

```ts
type HoldStatus = 'PENDING' | 'CAPTURED' | 'RELEASED' | 'EXPIRED' | 'FAILED';

interface Hold {
  holdId: string;
  payerAccountNumber: string;
  counterpartyAccountNumber?: string;
  amountMinor: number;
  currency: 'USD';
  status: HoldStatus;
  description?: string;
  createdAt: string; // ISO
  expiresAt?: string; // not used now
  relatedTransactionId?: string;
}

type HoldEvent =
  | {
      at: string; // ISO
      type: 'CREATED';
      createdByUserId?: string;
      idempotencyKeyHash?: string;
    }
  | {
      at: string; // ISO
      type: 'CAPTURED';
      transactionId: string;
      counterpartyAccountNumber: string;
    }
  | {
      at: string; // ISO
      type: 'RELEASED';
      reason?: string;
    }
  | {
      at: string; // ISO
      type: 'FAILED';
      code: 'INSUFFICIENT_FUNDS' | 'STATE_MISMATCH' | 'VALIDATION' | 'INTERNAL';
      message?: string;
    };
```

### Commands

```ts
type ReserveFundsCmd = {
  userId: string;
  idempotencyKey: string;
  holdId?: string;
  payerAccountNumber: string;
  amountMinor: number;
  description?: string;
  counterpartyAccountNumber?: string;
};

type CaptureHoldCmd = {
  userId: string;
  idempotencyKey: string;
  holdId: string;
  counterpartyAccountNumber?: string;
};

type ReleaseHoldCmd = {
  userId: string;
  idempotencyKey: string;
  holdId: string;
  reason?: string;
};
```

### State Machine

```
PENDING
  ├─(capture)──► CAPTURED
  └─(release)──► RELEASED
```

### Balance Semantics

- **Reserve**: `available -= amount`; ledger unchanged.
- **Release**: `available += amount`; ledger unchanged.
- **Capture**: `available += amount` (cancel reservation) **and** post a normal transfer which reduces payer ledger (and available) by `amount` and credits counterparty. Net available change = 0; ledger reflects the posted transfer.

---

## Persistence (DynamoDB, single table)

### Keys

- **Hold META**
  - `PK = HOLD#<holdId>`
  - `SK = META`
- **Hold EVENT**
  - `PK = HOLD#<holdId>`
  - `SK = EVENT#<ULID>` (ULID ensures lexicographic time order)
- **GSI (list holds by payer)**
  - **Index name**: `HOLD_GSI1`
  - **Attributes** (on Hold META):
    - `HOLD_GSI1PK = ACCOUNT#<payerAccountNumber>`
    - `HOLD_GSI1SK = <status>#<createdAt>#<holdId>`
  - Query patterns:
    - **Pending holds** by account: `HOLD_GSI1PK = ACCOUNT#X` + `begins_with(HOLD_GSI1SK, 'PENDING#')`, `ScanIndexForward=false` to get newest first.

> We do **not** store an `entity` attribute; the PK/SK prefixes encode type.

### Idempotency Items (reuse existing pattern)

- **Key**: `PK=USER#<userId>`, `SK=IDEMPOTENCY#<sha256(idempotencyKey)>`
- **Attributes**:
  - `holdId: string`
  - `command: 'RESERVE'|'CAPTURE'|'RELEASE'`
  - `createdAt: ISO`
  - `ttl: number`
  - `transactionId?: string` (present for `CAPTURE` so retries return the same txn)

---

## Command Execution (atomic TransactWrites)

### ReserveFunds (PENDING hold)

1. **Check**: payer account exists & active; amount > 0; USD.
2. **TransactWrite**:
   - `ConditionCheck` on account: `availableBalanceMinor >= :amount`
   - `Update` account: `SET availableBalanceMinor = availableBalanceMinor - :amount`
   - `Put` Hold META (`status='PENDING'`, timestamps, optional `counterpartyAccountNumber`)
   - `Put` Hold EVENT (`CREATED`)
   - `Put` Idempotency item (with `holdId`)

**Failure behavior**: all‑or‑nothing; insufficient funds aborts with no writes.

### ReleaseHold (cancel reservation)

1. **Load** hold; must be `PENDING`.
2. **TransactWrite**:
   - `Update` Hold → `RELEASED` with condition `status = 'PENDING'`
   - `Update` account: `SET availableBalanceMinor = availableBalanceMinor + :amount`
   - `Put` Hold EVENT (`RELEASED`)
   - `Put` Idempotency item

### CaptureHold (convert to posted transfer)

1. **Load** hold; must be `PENDING`. Determine `counterpartyAccountNumber` (from hold or cmd).
2. **Pre‑generate** `transactionId` (ULID) so it can be referenced inside the same transaction.
3. **Build** the existing transfer postings (payer → counterparty) using the pre‑generated `transactionId` and set `originHoldId = holdId`.
4. **TransactWrite** (single call) containing:
   - `Update` Hold to `CAPTURED` (condition `status = 'PENDING'`), set `relatedTransactionId = transactionId`
   - `Update` payer account: `availableBalanceMinor += :amount` (cancel reservation)
   - **Put/Update** all items required by the transfer posting (exactly as today), using `transactionId` and `originHoldId`
   - `Put` Hold EVENT (`CAPTURED`, includes `transactionId`)
   - `Put` Idempotency item for capture `{ holdId, transactionId }`

**Net effect**: available unchanged overall; ledger debited/credited by the transfer; hold becomes `CAPTURED` with link to the transaction.

---

## Activity Endpoint (single API for the FE)

### Route

```
GET /v1/accounts/{accountNumber}/activity?limit=20&cursor=...
```

### Semantics

- Returns a merged list of the **latest** items from:
  - **Hold lifecycle events** for the account (`HOLD_EVENT_GSI1` keyed by `ACCOUNT#...`)
  - **Posted transactions** for the account (existing repository query)
- **Ordering**: descending by event time
  - Hold events: `event.at`
  - Transactions: `postedAt` (or your canonical)
  - Tiebreaker A: `kind` (`POSTED_TRANSACTION` before hold events)
  - Tiebreaker B: `id` lexicographic
- **Pagination**: composite cursor that carries per‑source `LastEvaluatedKey` plus the last emitted item’s `(time, kind, id)` watermark.

### Types

```ts
type ActivityItem =
  | {
      kind: 'HOLD_CREATED';
      holdId: string;
      amountMinor: number;
      description?: string;
      createdAt: string;
      counterpartyAccountNumber?: string;
      createdByUserId?: string;
      idempotencyKeyHash?: string;
    }
  | {
      kind: 'HOLD_RELEASED';
      holdId: string;
      amountMinor: number;
      description?: string;
      releasedAt: string;
      releaseReason?: string;
    }
  | {
      kind: 'HOLD_CAPTURED';
      holdId: string;
      amountMinor: number;
      description?: string;
      capturedAt: string;
      transactionId: string;
      counterpartyAccountNumber: string;
    }
  | {
      kind: 'HOLD_FAILED';
      holdId: string;
      amountMinor: number;
      description?: string;
      failedAt: string;
      failureCode:
        | 'INSUFFICIENT_FUNDS'
        | 'STATE_MISMATCH'
        | 'VALIDATION'
        | 'INTERNAL';
      failureMessage?: string;
    }
  | {
      kind: 'POSTED_TRANSACTION';
      transactionId: string;
      amountMinor: number;
      description?: string;
      postedAt: string;
      originHoldId?: string;
    };

type ActivityResponse = { items: ActivityItem[]; nextCursor?: string };
```

### Cursor payload (base64‑encoded JSON)

```json
{
  "holdsLek": { "...": "..." },
  "txnsLek": { "...": "..." },
  "last": {
    "time": "2025-10-24T12:00:00.000Z",
    "kind": "POSTED_TRANSACTION",
    "id": "TXN_abc"
  }
}
```

### Merge algorithm (high level)

1. Fetch from **both** sources with a soft over‑read (`perSourceLimit = limit * 2`).
2. Merge in memory using ordering rules until `limit` items are emitted.
3. If either source has more (or we truncated), return a `nextCursor` containing the updated LEKs and `last`.
4. On the next call, resume from the per‑source LEKs and continue after `last` to avoid duplicates.

---

## Error Handling & Invariants

- Reserve: reject if insufficient available; no partial writes.
- Release/Capture: reject unless `status=PENDING`.
- Capture: reject if `counterpartyAccountNumber` is missing.
- Amounts are immutable (no partial/over‑capture in v1).
- Idempotency guarantees same output; conflicting parameters with same key → 409.

## Observability

- Logs include: `holdId`, `payerAccountNumber`, `counterpartyAccountNumber`, `transactionId`, `originHoldId`, `command`, `idempotencyKey` hash.
- Metrics (optional): `holds_created_total`, `holds_captured_total`, `holds_released_total`.

## Migration & Infra

- No new table.
- **Add GSI `HOLD_GSI1`** with keys `HOLD_GSI1PK`, `HOLD_GSI1SK` projected from Hold META.
- No changes to existing transaction schemas except adding optional `originHoldId` on the transaction header.

## Security

- No new public write endpoints. The Activity read endpoint follows existing authz for account access.
