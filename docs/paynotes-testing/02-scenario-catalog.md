# Scenario catalog

## Principle

The catalog must cover the full PayNote spectrum, from small deterministic flows
to document-heavy and real-MyOS canaries. When a scenario is not yet runnable,
its status must be explicit and documented.

## L1 — fast / parallel local live scenarios

### Implemented and active

1. `transfer-reserve-capture`

   - funded payer and payee accounts
   - reserve followed by capture
   - duplicate capture replay must not duplicate balances

2. `fetch-by-id-fallback-smoke`

   - bank webhook body `{ "id": eventId }`
   - bank fetches the full event from MyOS
   - replay remains idempotent

3. `card-delivery-capture`

   - delivery identification works locally
   - acceptance works locally
   - root PayNote bootstrap and capture now pass locally end to end

4. `pending-install-approval-capture`
   - delivery/bootstrap-backed card flow now creates the expected hold mapping
   - deterministic summary generation exposes the pending action through the
     normal customer contract route
   - customer approval followed by capture now passes locally end to end

### Implemented but blocked / skipped

## L2 — serial / complex local live scenarios

### Planned and currently skipped

5. `milestones-partial-captures`

   - milestone captures: `8_000`, `12_000`, `7_000`, `9_000`
   - needs stateful MyOS continuation after each customer approval

6. `subscription-mandate-cycle`

   - initial capture
   - mandate bootstrap
   - one follow-up cycle
   - needs mandate bootstrap target-session linking and completion events

7. `voucher-monitoring`
   - delivery / satisfaction
   - voucher monitoring
   - cashback continuation
   - needs monitoring report delivery and linked voucher auto-start

## L3 — real MyOS E2E canaries

### Planned and currently skipped

8. `real-myos-card-delivery-happy-path`
9. `real-myos-subscription-one-follow-up-cycle`
10. `real-myos-voucher-smoke`
11. `real-myos-fetch-by-id-compatibility-smoke`
