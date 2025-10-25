# Changelog

## Unreleased

- **Breaking**: Removed `GET /v1/accounts/{accountId}/transactions` in favour of `GET /v1/activity/{accountNumber}`. The consolidated activity endpoint now returns posted transaction metadata (`side`, `status`, `type`, `counterpartyAccountNumber`) alongside hold lifecycle events.
- Updated frontend/SDK consumers to call the activity endpoint and render hold + transaction timeline badges.
- Purged legacy observability counters for transaction listing and updated generated OpenAPI definitions.
