# Requirements - Bank Primitives for Merchant-Funded PayNotes (Demo Bank)

## Date

2026-01-30

## Overview

This document specifies bank primitives required to support merchant-funded PayNotes and future partner settlement. These requirements are independent of any particular PayNote/voucher document type.

## Functional Requirements

### FR-BP-1 Merchant signup captures external merchant identity

- The bank signup UI MUST support signing up as a merchant.
- Merchant signup MUST capture `merchantId` (external id from the processor).
- The backend MUST treat presence of `merchantId` as merchant identity (no separate `isMerchant` boolean required).
- The bank MUST isolate merchant identity mapping behind a resolver boundary so `merchantId == userId` can be changed later without pervasive refactors.

### FR-BP-2 Merchant credit line account is created on signup

- On merchant signup, the bank MUST auto-create one funding account of type `CREDIT_LINE`.
- The account MUST have a configurable default credit limit (demo setting).
- The credit limit MUST be editable from the bank UI (demo convenience).

### FR-BP-3 Credit limit invariants

When changing `creditLimitMinor` for a credit line:

- The bank MUST NOT allow reducing the limit below already committed exposure:
  - posted balance usage + reserved (holds) usage.
- The bank MUST return a clear error if the user attempts an invalid reduction.

### FR-BP-4 Card transaction model persists `merchantId`

- Card authorization endpoints MUST accept `merchantId` and persist it on:
  - authorization holds,
  - posted transactions.
- Captures MUST preserve `merchantId` association from the original authorization.

### FR-BP-5 Holds support partial capture

- Holds MUST support multiple captures until exhausted.
- Hold state MUST track:
  - `authorizedAmountMinor`
  - `capturedAmountMinor`
  - status transitions: `PENDING` → `PARTIALLY_CAPTURED` → `CAPTURED` (or equivalent).
- Partial capture MUST be idempotent using a stable idempotency key provided by the caller (e.g., `(sourceContractId, purchaseTransactionId)` or another stable key).

### FR-BP-6 Relationship indexing between contracts and bank objects

The bank MUST support many-to-many “related” queries:

- By `transactionId`: list related contract ids/sessions.
- By `contractSessionId`: list related transactions and holds.

Implementation constraints:

- Relationship writes MUST be idempotent.
- Relationship indexing MUST support efficient queries (no full scans).

### FR-BP-7 Basic observability and correlation

For merchant-funded flows, logs MUST include (where applicable):

- merchantId,
- merchant account id,
- transaction id,
- hold id,
- idempotency key.

## Acceptance Criteria

- Merchant signup results in a credit line account created and visible in the UI.
- Merchant credit limit can be increased/decreased within invariants.
- Card authorization/capture persists merchantId on holds and posted transactions.
- Partial capture can be executed multiple times against a single hold without over-capture and without duplicates under retries.
- Related contracts can be listed from a transaction id and related transactions/holds can be listed from a contract id/session.
