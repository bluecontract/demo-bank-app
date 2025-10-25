# Holds Implementation Plan

## Iteration 7 – Activity Feed Migration

- ✅ Frontend and SDK consumers have switched from `GET /v1/accounts/{accountId}/transactions` to `GET /v1/accounts/{accountNumber}/activity`.
- ✅ `/transactions` list route, handler, and contract entries removed from the bank API.
- ✅ Activity feed now returns posted transaction metadata (`side`, `status`, `type`, `counterpartyAccountNumber`) alongside hold lifecycle events so UI can render mixed timelines.
- 🔄 Follow-up: keep monitoring downstream automation and e2e suites once the new feed stabilises.

Earlier iteration notes live in design docs (`docs/design/006-holds.md`) and problem exploration artefacts. Future iterations should continue tracking PayNote capture flows and observability metrics for holds vs posted entries.
