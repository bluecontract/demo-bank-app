# Problem Exploration - PayNote Voucher Flow + Pending Actions + Inbox UX (Demo Bank)

## Date

2026-01-30

## Update note (2026-02-12)

Contract-driven transaction initiation (`Linked/Reverse Card Charge`) and
Payment Mandate-first sequencing are extended in:

- `docs/problem-exploration/014-linked-card-charge-and-payment-mandate.md`

Mandate orchestration update (2026-02-13):

- authorization/settlement now follows async `chargeAttemptId`-correlated saga,
- cumulative mandate usage is tracked in mandate document state.

This document remains valid for Delivery/proposal, voucher, monitoring, and
Inbox UX context.

## Context

The demo bank already supports:

- card transaction lifecycle (authorization/holds, captures, posted transactions),
- merchant-originated PayNote proposals delivered through MyOS via a **Synchrony Merchant** document and **PayNote Delivery**,
- MyOS bootstrap orchestration (asynchronous bootstrap process),
- bank UI for listing and viewing contracts.

We are finalizing a clearer integration model for card-linked PayNotes and voucher-like PayNotes, and upgrading the customer contracts UX to an inbox model similar to Gmail.

## Problem

### 1) PayNote Delivery is internal transport

PayNote Delivery is a coordination artifact between the processor/merchant and the bank:

- embeds the PayNote proposal template,
- carries correlation metadata and status,
- receives accept/reject recorded by the bank,
- allows the processor to learn the outcome by observing Delivery updates.

Customers should not see Delivery documents. They should see:

- a **proposal UI** derived from Delivery (Accept/Reject),
- then the **active PayNote** once bootstrapped.

### 2) Card-linked PayNotes must be explicit and status-aware

We introduce an allow-listed PayNote type for the card flow:

- `PayNote/Card Transaction PayNote`

It extends `PayNote/PayNote` and adds `cardTransactionDetails`.

All PayNotes (including Card Transaction PayNote) can include:

- `transactionStatus: PayNote/Transaction Status`

The merchant/processor may provide `transactionStatus` in the proposed PayNote. The bank validates it against its current transaction state. If missing, the bank sets it at PayNote bootstrap.

### 3) Voucher behavior is merchant-defined

We do not create a bank-specific “Voucher” type.

A voucher is a merchant-defined document instance of:

- `PayNote/Merchant To Customer PayNote`

The merchant defines the workflow (reserve → request monitoring → capture on reports). The bank enforces policy at runtime by deciding which requests it honors and by emitting standardized result/report events.

### 4) Customer approvals are modeled as Pending Actions

Some bank-handled requests require explicit customer action (e.g., card transaction monitoring). This should be generic:

- a contract emits a bank-supported request (e.g., Start Monitoring),
- the bank classifies it as requiring customer action,
- the bank creates a **Pending Action** record linked to the contract,
- when the customer opens the contract, they see pending actions and can act.

Optionally, a document may explicitly request a pending action using a generic event (e.g., “Customer Action Requested”) that includes a message and an operation to execute. The bank may translate it into a pending action.

### 5) Monitoring requires explicit consent, but consent is a generic contract type

If the customer approves monitoring:

- the bank bootstraps a consent contract of type `Conversation/Customer Consent`,
- the document name and description are human-readable (e.g., “Card Transaction Monitoring Customer Consent”),
- the consent doc is not shown in a dedicated contracts tab; it is reachable from a low-visibility **Data permissions** entry (for example in side/burger navigation),
- revoking the consent stops monitoring and triggers `Card Transaction Monitoring Stopped` injected into the requesting contract.

Important: The customer does not operate in MyOS. The bank represents the customer in the consent document via channel bindings / account identifiers, while the merchant sees the consent in its own MyOS account.

### 6) Contracts UX should be Inbox-first

We want a single-page inbox list and navigation like Gmail:

- the list takes the whole page (no split view),
- clicking a row opens a contract page with a back button,
- list columns:
  - sender
  - contract name
  - last change preview (one short sentence)
  - last update timestamp
- no contracts tabs in this iteration (Inbox is the primary view),
- consent/data-permission management is reachable via a low-visibility **Data permissions** entry in side/burger navigation.

### 7) Summary + history must be pre-generated

We require:

- contract summary regeneration on every contract change,
- a dedicated short “last change” sentence used as the list preview,
- stored human-readable history entries (chronological),
- no UI “loading summary” state: updates are only surfaced once the new summary is stored.

## Scope of this iteration

- Card Transaction PayNote proposal flow (Delivery internal, proposal UI external).
- PayNote `transactionStatus` validation/auto-fill.
- Voucher demo via Merchant-to-Customer PayNote instance using monitoring and capture.
- Monitoring approval as a Pending Action, and consent as `Conversation/Customer Consent` contract.
- Inbox-first UX (no tabs) with low-visibility Data permissions entry, plus summary/history pipeline.

## Non-goals

- Partnerships and cross-merchant settlements.
- Monitoring authorizations/refunds/reversals (design should be extensible; implementation targets posted transactions).
- Full reconciliation rules when monitoring stops (beyond stopping reports and letting voucher terminate).
