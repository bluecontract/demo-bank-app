# Known gaps and blockers

This document tracks problems discovered while building the PayNote suite.
Production bank logic must not be changed in this track to make tests pass.

## Typical blocker classes

### 1. Route or contract mismatch

Symptoms:

- a helper targets the wrong endpoint
- a helper uses the wrong request or response shape

Action:

- align the helper to the real contract first
- if the repo lacks a stable read model, record it as a testability gap

### 2. Summary coupling

Symptoms:

- a delivery or contract becomes visible only after summary generation
- a user-facing route stays hidden despite the raw record existing

Action:

- do not patch runtime logic blindly
- document the dependency and decide whether the suite should use a different
  bank-side assertion path

### 3. Hard-coded retry or timing behavior

Symptoms:

- tests become slow or non-deterministic due to built-in retry logic

Action:

- do not patch runtime timing in this track
- record the stability and timing impact explicitly

### 4. Local harness continuation gaps

Symptoms:

- a local harness can reproduce the early part of a flow, but not the full MyOS
  continuation chain needed for bootstrap, mandate, or voucher flows

Action:

- document the missing continuation events or document shapes
- keep the scenario implemented but skipped until the harness catches up

Current concrete gaps in this repo:

- milestones:
  - harness cannot take the bank's `Customer Action Responded` operation and
    synthesize the next epoch's capture request plus the next pending action
- subscription:
  - harness cannot synthesize payment-mandate bootstrap target sessions and the
    bootstrap-completion webhook that links the mandate back to the requesting
    PayNote session
- voucher:
  - harness cannot inject the monitoring-report -> linked voucher bootstrap ->
    cashback capture chain with real event ordering
