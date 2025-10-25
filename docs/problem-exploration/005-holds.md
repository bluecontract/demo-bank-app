# Holds (Funds Reservation) — Problem Exploration

## Background

We repurposed the interview demo into a demo **bank app** intended to present an integration with **MyOS PayNotes**. The PayNotes flow requires the bank to **reserve (block) funds** at initiation time and later **either capture** or **release** those funds based on an external decision. Today, the bank supports only **posted internal transfers** between accounts inside the bank. There is no notion of pending funds or authorizations.

For this phase we want to introduce a **Holds (Authorization)** capability **without** implementing the PayNotes integration or customer‑facing UI. The feature should be production‑grade in terms of atomicity, idempotency, auditability, and queryability so that (a) we can integrate PayNotes later with minimal changes and (b) the FE can consume a merged **Activity** feed that includes both **pending holds** and **posted transactions** in a single ordered timeline.

## Problem

We need a way to:

1. **Reserve** an amount on a payer’s account so that the **available balance** is reduced while the **ledger/current balance** remains unchanged.
2. **Capture** the reserved funds later as a normal posted **internal transfer** (payer → target account number).
3. **Release** the reservation (no posted transfer) and restore the payer’s available balance.
4. Provide a **single Activity feed** that merges **pending holds** and **posted transactions** in stable order with cursor‑based pagination.
5. Ensure **auditability** and **idempotency** for all state transitions.

## Constraints & Guides

- Currency: **USD** only; amounts in **minor units** (integer).
- Accounts are addressed by **account number** (not internal IDs), matching the current posting/transfer path.
- No external payment rails in this phase; **capture** moves funds to any **internal account number** (could belong to the same user or another).
- No customer‑facing writes or PayNotes bootstrap/webhooks in this phase.
- No **expiry** logic in this phase (can be added later).
- The ledger should remain clean: only **posted transactions** affect **ledger/current**; holds affect **available** only.
- Single table (DynamoDB) design must be preserved.

## Definitions

- **Hold (Authorization)**: a reservation that reduces **available balance**; not a posted debit.
- **Capture**: converts the reservation into a posted internal transfer (debit payer, credit counterparty).
- **Release**: cancels the reservation with **no** posted transfer.
- **Activity**: a read model that merges pending holds and posted transactions into one feed for the FE.

## Out of Scope

- PayNotes bootstrap/webhook implementation.
- Public HTTP endpoints for creating/capturing/releasing holds.
- External banks/rails.
- Expiry/extension of holds.
- Customer‑facing UI beyond a future **Activity** endpoint.

## Stakeholders & Users

- **Backend**: adds domain commands and persistence.
- **Frontend**: later consumes a single **Activity** endpoint (merged holds + txns).
- **Demo operators**: can simulate end‑to‑end via domain commands or a dev harness until PayNotes is wired.

## Success Criteria (Problem Level)

- We can create, capture, and release holds atomically with idempotency.
- Balances behave as customers expect: available reflects reservations; ledger reflects final posted entries only.
- A single Activity endpoint can return a consistent, paginated mix of pending holds and posted transactions.
- The design is ready for PayNotes to call into the same domain commands later.
