# Solution Design - Bank Primitives for Merchant-Funded PayNotes (Demo Bank)

## Date

2026-01-30

## Summary

We implement bank primitives needed for merchant-funded PayNotes:

- Merchant identity capture (`merchantId`) and a mapping boundary.
- Merchant funding modeled as a `CREDIT_LINE` account with configurable limit.
- `merchantId` persisted on holds and transactions.
- Holds support partial capture with idempotency.
- Relationship indexing supports contract ↔ transaction ↔ hold queries for UI.

## Merchant identity

### Data model

User profile:

- `merchantId?: string`

Resolver boundary:

- `MerchantIdentityResolver` maps external `merchantId` to internal merchant user/account ids.
- The initial demo mapping can be `merchantId == userId` but must not leak into business logic.

## Credit line account model

### Account fields

- `type: CREDIT_LINE`
- `creditLimitMinor`
- `postedBalanceMinor` (exposure already realized)
- `heldAmountMinor` (exposure reserved in holds)
- `availableCreditMinor = creditLimitMinor - postedBalanceMinor - heldAmountMinor`

### Operations

- `createCreditLineAccount(merchantUserId, defaultLimitMinor)`
- `updateCreditLimit(accountId, newLimitMinor)` with invariant checks.

## Card transaction persistence

Authorization hold record includes:

- `holdId`
- `merchantId` (external)
- `merchantAccountId` (derived via resolver when needed)
- amounts and status

Posted transaction record includes:

- `transactionId`
- `merchantId` (external)
- payer account id
- capture linkage to authorization hold id (if applicable)

## Holds and partial capture

### Hold record fields

- `authorizedAmountMinor`
- `capturedAmountMinor`
- `status` (PENDING / PARTIALLY_CAPTURED / CAPTURED)

### Partial capture algorithm

Input:

- `holdId`
- `amountMinor`
- `idempotencyKey` (caller-provided stable key)

Steps:

1. If capture exists for `(holdId, idempotencyKey)`, return existing result.
2. Validate `amountMinor > 0` and `capturedAmountMinor + amountMinor <= authorizedAmountMinor`.
3. Create a capture transaction, update hold captured amount and status.
4. Update account exposures appropriately.

## Relationship indexing

### Purpose

Support UI:

- transaction details → related contracts
- contract details → related transactions and holds

### Approach

Maintain reverse indexes (append-only for demo):

- `TXN#<transactionId> -> CONTRACT#<contractSessionId>`
- `HOLD#<holdId> -> CONTRACT#<contractSessionId>`
- optionally forward indexes for contract → list of related ids.

Writes are idempotent:

- use conditional put or unique composite keys to avoid duplicates.

## UI surfaces enabled by primitives

- Merchant signup toggle and merchantId capture.
- Merchant account page showing credit line limit and exposures.
- Transaction details page with “Related contracts” powered by reverse index.
- Contract details page with “Related transactions/holds”.

## Observability

Log and persist correlation identifiers:

- merchantId, accountId, holdId, transactionId, idempotencyKey.
