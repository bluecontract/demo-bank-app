# Requirements Specification – Saved Recipients

## Date

2025-07-05

## Use Cases

1. Save a new recipient with name and account number
2. View list of saved recipients
3. Edit recipient name or account number
4. Delete a recipient
5. Select a saved recipient when sending a transfer
6. Show recipient name in transaction list if account number matches
7. Hide name if recipient is deleted

## Functional Requirements

| ID       | Requirement                                                                           | Priority |
| -------- | ------------------------------------------------------------------------------------- | -------- |
| FR-REC-1 | User can create, update, and delete their own recipients                              | Must     |
| FR-REC-2 | Duplicate account numbers across recipients per user are not allowed                  | Must     |
| FR-REC-3 | Transfers reference only account numbers; recipient names are optional UI enhancement | Should   |
| FR-REC-4 | Transactions display recipient names if applicable                                    | Should   |
| FR-REC-5 | Only valid bank accounts may be saved as recipients                                   | Must     |

## Non-Functional Requirements

| ID        | Category     | Requirement                                                     | Metric/Target           |
| --------- | ------------ | --------------------------------------------------------------- | ----------------------- |
| NFR-REC-1 | Performance  | Fast retrieval for use in transfer UI and transaction rendering | p95 latency ≤ 300 ms    |
| NFR-REC-2 | Security     | Account numbers must not be exposed in API routes or logs       | No leakage in logs/APIs |
| NFR-REC-3 | Reliability  | Ensure atomicity when updating account number                   | No partial updates      |
| NFR-REC-4 | Architecture | Consistent with hexagonal architecture used in other modules    | Follows project pattern |

## Acceptance Criteria

- User can add, edit, and delete recipients; changes are reflected immediately in the UI.
- Attempting to add a duplicate account number for the same user is prevented with a clear error.
- Only existing/valid account numbers can be saved as recipients; invalid entries are rejected.
- When sending a transfer, user can select from their saved recipients.
- Transaction list displays recipient names where available; if a recipient is deleted, the name is hidden.
- No account numbers are exposed in API responses or logs.
- All operations are atomic; no partial updates occur on failure.
