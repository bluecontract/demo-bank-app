# PayNote tests

This directory contains the dedicated PayNote test suite split across local live
integration and real MyOS canary coverage.

## Layout

- `lib/` — shared env/bootstrap helpers used by PayNote suites
- `setup/` — Vitest setup files for suite-specific defaults
- `live/` — LocalStack-backed and harness-backed live integration scenarios
- `e2e/` — small serial canaries against real MyOS

## Rules

- keep the main live/E2E event delivery mode as **pull-and-post with the same
  webhook-shaped payload that MyOS sends in production**
- keep `{ "id": eventId }` as a small compatibility smoke path only
- use reusable setup helpers for funded accounts, funded cards, and transfer
  pairs
- keep new simple and scaled scenario amounts below `100_000` minor units
- give every payment scenario enough funding buffer to avoid false negatives
- use `LLM_SUMMARY_DISABLED: true` fixtures together with deterministic summary
  fields
- load MyOS credentials from the repository root `.env.agent` file or compatible
  environment aliases
