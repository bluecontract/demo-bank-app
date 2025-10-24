# ADR: Off‑Ledger Holds vs Internal Hold Account

- **Status**: Accepted
- **Date**: 2025‑10‑24

## Context

We need to support “funds blocking” for future PayNotes integration and to provide a coherent Activity feed that shows pending items and posted transactions. Two approaches were considered:

1. **Off‑ledger holds (encumbrances as separate records)**  
   Holds reduce **available balance** and are tracked as their own entities with lifecycle events. Only **capture** creates a posted ledger transaction.

2. **Internal hold account (encumbrance postings)**  
   At reserve time post a debit to customer and a credit to a synthetic “Hold Vault” account (but excluded from balances); on release/capture reverse/convert entries.

## Decision

Choose **Off‑ledger holds** (approach 1).

## Rationale

- Keeps the **posted ledger clean** — only final settlements are posted.
- **Simpler** implementation with current codebase: today’s balance maths already separate **ledger/current** and **available**.
- Reduces risk of encumbrance entries accidentally leaking into statements or balance calculations.
- Matches common user expectations: pending items are not “transactions” yet.

## Consequences

- Holds are **not** visible as posted transactions; they are surfaced via the **Activity** read model alongside posted transactions.
- **Release** creates **no** posted entries; auditability is provided by **Hold events**.
- We need a small **merge layer** to build the Activity feed (done in this phase).

## Alternatives Considered

- Internal hold account with encumbrance postings: more “pure” accounting but heavier and riskier given current architecture.
- Booking holds into the ledger directly: rejected; would pollute the posted ledger and complicate statements.
