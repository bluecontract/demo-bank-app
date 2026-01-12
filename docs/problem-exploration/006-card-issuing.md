# Problem Exploration - Demo Bank Card Issuing and Processor Integration

## Date

2026-01-15

## Context

Blue Demo Bank already supports accounts, funding, transfers, and holds. We now
need a demo card issuer path so the demo payment processor can route BIN 123456
cards to the bank, and the bank can authorize and capture those transactions.
We treat the demo issuer as a Synchrony-style store card program, where the
bank is the issuer and settlement goes to an internal clearing account.

## Goals

- Issue cards tied to bank accounts with BIN 123456 and demo-safe handling of
  PAN and CVC.
- Provide an issuer API for authorization and capture that the demo payment
  processor can call.
- Use the existing hold and ledger design so authorizations impact available
  balance and captures post a ledger entry.
- Surface authorization and capture activity in the account history and UI
  with merchant context.
- Keep the solution aligned with existing bank API contracts and the DynamoDB
  single-table model.

## Non-Goals

- Real network integrations, interchange, or PCI-compliant tokenization.
- Refunds, reversals, chargebacks, partial captures, or incremental auth.
- Multi-currency support or card shipping/fulfillment.
- Customer-facing dispute or card controls beyond basic status.

## Users and Personas

- Demo evaluator: issues a card and sees card activity in the account timeline.
- Demo payment processor: calls the bank issuer APIs to authorize and capture.
- Demo developer: wants minimal surface area with clear alignment to existing
  holds and activity design.

## Scenarios

1. A signed-in user issues a card for an account and receives card details once
   (PAN starts with 123456).
2. A demo checkout submits a card starting with 123456; the processor routes to
   the bank authorization API.
3. The bank approves, creates a hold, and returns an authorization id; the
   processor stores it.
4. The processor captures the authorization; the bank records a hold capture
   event, posts a ledger transaction, and returns a transaction id.
5. The account activity feed shows the pending hold (`HOLD_CREATED`), the hold
   capture (`HOLD_CAPTURED`), and the posted transaction with merchant name,
   amount, and card last4.
6. If the card is invalid, expired, or has insufficient funds, the bank
   declines and no hold is created.

## Constraints and Assumptions

- Currency is USD only.
- Card numbers must start with BIN 123456 and be Luhn valid.
- PAN and CVC are never stored or logged; only masked and hashed values are
  persisted.
- External processor calls must use service authentication (not end-user
  cookies).
- Authorizations should use the existing holds flow to preserve balance
  semantics.

## Decisions (Resolved for v1)

- Card freeze/unfreeze is out of scope; issue-only is enough.
- Multiple cards per account are allowed immediately.
- CVC verification is enforced for authorization requests.
