# Requirements Specification - Card Issuing and Processor Integration

## Date

2026-01-15

## Functional Requirements

| ID         | Requirement                                                                                                                                                                                                          | Priority |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-CARD-1  | Issue Card: A signed-in user can issue a new card for a bank account they own. The system generates `cardId`, PAN (16 digits), expiry month/year, and CVC, and sets status to `ACTIVE`.                              | Must     |
| FR-CARD-2  | BIN Rule: All issued PANs start with `123456` and are Luhn valid and unique.                                                                                                                                         | Must     |
| FR-CARD-3  | Card Ownership: Each card is linked to exactly one account; an account may have multiple cards; only the owning user can list or issue cards for their accounts.                                                     | Must     |
| FR-CARD-4  | Card Reveal: Full PAN and CVC are returned at issuance and on card detail retrieval for the owning user; list responses return masked PAN (last4) only.                                                              | Must     |
| FR-CARD-5  | UI Cards Panel: The web app provides a Cards section per account that lists cards with last4, expiry, status, and allows opening a card details view with full PAN and CVC.                                          | Must     |
| FR-CARD-6  | Processor Auth API: Provide a server-to-server endpoint to authorize card transactions using PAN, expiry, CVC, amount, currency, merchant info, and a processor charge id.                                           | Must     |
| FR-CARD-7  | Authorization Holds: Successful authorization creates a hold that reduces available balance and returns an `authorizationId` (hold id).                                                                              | Must     |
| FR-CARD-8  | Capture API: Provide a capture endpoint that takes `authorizationId` and amount (must equal the authorized amount in v1), records a hold capture event, and posts a ledger transaction to a card settlement account. | Must     |
| FR-CARD-9  | Idempotency: Authorization and capture support `Idempotency-Key` and return the original result on retries; conflicting payloads return 409.                                                                         | Must     |
| FR-CARD-10 | Decline Semantics: Authorization failures return a normalized `declineCode` and short `message` (card not found, inactive, expired, invalid CVC, insufficient funds).                                                | Must     |
| FR-CARD-11 | Activity Visibility: Card activity includes `HOLD_CREATED` for authorization and both `HOLD_CAPTURED` and `POSTED_TRANSACTION` entries on capture, with merchant name, amount, card last4, and processor reference.  | Must     |
| FR-CARD-12 | Demo Data Handling: Raw PAN/CVC are stored in the bank data store for demo access and never logged; cards and card-related items written for `isTest=true` users include a TTL.                                      | Must     |
| FR-CARD-13 | Processor Auth: Processor endpoints require a dedicated service credential (API key or signed token) distinct from end-user sessions.                                                                                | Must     |
| FR-CARD-14 | CVC Verification: Authorization requests must validate CVC against a stored hash and decline on mismatch.                                                                                                            | Must     |

## Non-Functional Requirements

| ID         | Category      | Requirement                                                                                                           | Metric/Target           |
| ---------- | ------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| NFR-CARD-1 | Security      | Raw PAN/CVC stored only in the bank data store, never logged; use HMAC hash for lookup and masked values for display. | 0 raw PAN/CVC in logs   |
| NFR-CARD-2 | Performance   | Authorization and capture p95 latency <= 1s at 50 RPS.                                                                | p95 <= 1s               |
| NFR-CARD-3 | Integrity     | Authorization and capture are atomic and consistent with hold and ledger semantics.                                   | No partial writes       |
| NFR-CARD-4 | Availability  | Card issuer endpoints available at least 99.5 percent.                                                                | >= 99.5 percent         |
| NFR-CARD-5 | Observability | Structured logs include cardId, authorizationId, processorChargeId, and accountNumber (no PAN).                       | 100 percent of requests |
| NFR-CARD-6 | Compatibility | Changes align with existing account, holds, and activity feed contracts.                                              | No breaking changes     |

## Acceptance Criteria (E2E Reference Flow)

- Issuing: User signs in, issues a card for an account, and can view PAN (BIN
  123456), expiry, and CVC on the card details view; card lists remain masked.
  Multiple cards can be issued for the same account.
- Authorization (happy path): Demo processor submits a test checkout with a
  123456 card and valid CVC; bank returns `APPROVED` with `authorizationId` and
  creates a hold that reduces available balance.
- Capture: Processor captures the authorization; bank records `HOLD_CAPTURED`,
  posts a ledger transfer to the settlement account, and returns
  `transactionId`; activity feed shows `HOLD_CREATED`, `HOLD_CAPTURED`, and
  `POSTED_TRANSACTION` entries with merchant name and card last4.
- Declines: Invalid CVC returns `DECLINED` with `declineCode=invalid_cvc`;
  insufficient funds returns `declineCode=insufficient_funds`; no hold is
  created on decline.
- Idempotency: Repeating authorization/capture with the same `Idempotency-Key`
  returns the original response; conflicting payloads return 409.
- Auth: Processor endpoints reject requests without valid service credentials.
