# Problem Exploration - Bank Primitives for Merchant-Funded PayNotes (Demo Bank)

## Date

2026-01-30

## Context

The demo bank is evolving toward supporting programmable contracts (Blue / MyOS) that can trigger bank actions such as:

- reserving funds (holds),
- capturing funds (full / partial),
- correlating bank transactions with contracts,
- presenting contracts and related financial activity to end users in a usable UI.

To support merchant-funded PayNotes (e.g., vouchers/cashback), the bank needs core primitives that do not depend on any specific PayNote type or voucher logic.

## Problem

### 1) Merchants need a funding account in the bank

Merchants originate PayNote proposals through the processor, but they must also be able to fund obligations created by those PayNotes (cashback, vouchers, promotions, future partnership settlement).

In the demo, merchants do not have “real” deposit accounts. We need a simple bank-side representation of a merchant funding source that can:

- be auto-created at signup,
- support a configurable spending limit,
- support negative balances / outstanding exposure (credit-like behavior),
- support holds and captures.

### 2) The bank must persist `merchantId` from the processor

Card authorizations/captures must carry a stable external `merchantId` (processor identity). The bank must persist this on:

- authorization holds,
- posted transactions.

This enables correlation:

- “Which merchant is involved?”
- “Which merchant account should be charged for merchant-funded payouts?”
- “Which transactions should be linked to contracts?”

### 3) Captures must support partial capture from a hold

Voucher/cashback flows often involve multiple payouts over time against a fixed funding limit.

We need partial capture as a first-class primitive:

- hold can be captured multiple times until exhausted,
- hold lifecycle supports partial capture state transitions,
- idempotency is enforced to avoid double-payouts.

### 4) Contracts and bank objects require relationship indexing

UX requirements include:

- from a transaction: show “related contracts”,
- from a contract: show “related transactions” and “related holds”.

This is many-to-many:

- one contract → many transactions,
- one transaction → many contracts,
- one contract → many holds,
- one hold → many contracts (in future).

We need durable relationship indexing that is efficient to query and can be updated idempotently.

## Scope (these primitives)

- Merchant signup with external `merchantId`.
- Merchant funding account modeled as a **credit line** (configurable limit).
- Card transaction model stores `merchantId` on holds and posted transactions.
- Holds support partial capture with idempotency.
- Relationship indexing between contracts ↔ transactions ↔ holds.

## Non-goals

- Voucher-specific logic and monitoring (covered by separate voucher integration docs).
- Partnership settlement and merchant-to-merchant obligations.
- Real underwriting/risk controls for credit lines (demo assumptions).

## Assumptions

- In the demo, merchantId is initially equal to the processor userId, but the mapping must be isolated so it can change later.
- The bank UI may allow a merchant user to edit credit limit as a demo convenience.
