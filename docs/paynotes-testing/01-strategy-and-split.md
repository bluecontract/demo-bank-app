# Strategy and split

## Goal

The objective is not to test a single handler in isolation. The suite must show
that the bank can process end-to-end PayNote flows across delivery, reserve,
capture, pending actions, mandates, vouchers, and MyOS integration without
changing production banking logic in this track.

## Test layers

### L0 — unit and use-case tests

Keep narrow edge cases, validation, and small data-shaping checks here.

### L1 — local live integration

This is the primary PR-gate layer.

System under test:

- the bank API and handlers
- LocalStack-backed AWS dependencies
- a thin MyOS protocol harness for deterministic local flows

Characteristics:

- invoke the bank through real API routes used by current integration tests
- assert through bank APIs, account activity, holds, transactions, and recorded
  outbound MyOS calls
- use explicit event synchronization after each business action
- use **full webhook payload forwarding** as the main path
- keep `{ "id": eventId }` only as a small compatibility smoke path

### L2 — serial complex local live scenarios

Use the same infrastructure as L1, but reserve it for multi-step flows that are
harder to parallelize, for example:

- milestone partial captures
- subscription + mandate follow-up cycle
- voucher / monitoring / reverse-auth flows
- pending actions with additional inputs such as timestamps

### L3 — real MyOS E2E canaries

Keep this layer small, serial, and focused on a few high-value canaries. It is
not the main PR gate.

## Design rules

1. Prefer helper-based setup over scenario-local boilerplate.
2. Keep funded accounts over-provisioned to avoid false negatives from
   insufficient funds.
3. Keep new simple and scaled scenarios below `100_000` minor units.
4. Reuse assertions, waiters, reporting, and event synchronization helpers.
5. Do not rely on blind sleeps as the main synchronization mechanism.
6. If a production bug blocks a flow, preserve the test or test sketch and
   document the blocker instead of patching production logic.

## Why not run everything as real MyOS E2E

Running everything against live MyOS would be slower, less deterministic, and
harder to debug. The suite should therefore use local live integration as the
main development and PR-gate layer, then validate a smaller number of real MyOS
canaries separately.
