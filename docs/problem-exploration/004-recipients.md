# Problem Exploration – Saved Recipients

## Date

2025-07-05

## Context

Currently, users must manually enter account numbers for every transfer, which is error-prone and inefficient. There is no way to save or manage frequently used recipients, leading to poor UX. Introducing a "Saved Recipients" feature would streamline repeated transfers and improve the overall demo experience.

## Stakeholders & Personas

- **Bank User** – wants to save frequently used recipients for faster, safer transfers and to see human-friendly names in transaction history.
- **Demo Evaluator** – expects a modern, user-friendly banking demo with features reflecting real-world convenience.

## Scope / Use-Case Scenarios

1. When a user transfers money, they should be able to select from saved recipients instead of re-entering account numbers.
2. When a user wants to add a new recipient, they should be able to save an account number with a display name (after validation).
3. When viewing transaction history, users should see display names for recipients where available.
4. Users should be able to view, edit, and delete their saved recipients.

## Constraints & Assumptions

- Recipient data is user-specific and private.
- Account numbers must be validated (must exist).
- Duplicates (same account number) must be avoided per user.
- Must not expose account numbers externally.
- Must support efficient lookup and mutation in DynamoDB.
- Must maintain strict uniqueness (one recipient per account number per user).
