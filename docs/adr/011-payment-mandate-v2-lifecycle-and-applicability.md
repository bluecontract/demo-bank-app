# ADR 011: Payment Mandate v2 lifecycle identity and applicability

## Status

Accepted (2026-03-05)

## Context

Previous mandate integration mixed bootstrap and final mandate identity and
gated too many operations with mandate checks.

In particular:

- bootstrap response session id was sometimes treated as final mandate session,
- existing-hold capture was mandate-gated even when no new exposure was created.

## Decision

1. Identity model for bootstrap pending action payload is split into:
   - `paymentMandateBootstrapSessionId` (bootstrap session only),
   - `paymentMandateSessionId` (final linked mandate session),
   - `paymentMandateDocumentId` (final linked mandate document id).
2. Applicability matrix:
   - mandate required for operations creating new holds/charges,
   - mandate optional for existing-hold capture.
3. Existing-hold capture with mandate id:
   - capture execution is not blocked by mandate,
   - settlement report to mandate is attempted best-effort,
   - mandate-report failure does not revert successful capture.
4. Correlation semantics:
   - `authorizationId` is preferred for mandate orchestration,
   - `chargeAttemptId` remains legacy-compatible alias.

## Consequences

- Bootstrap lifecycle is explicit and no longer conflates intermediate and final
  identities.
- Existing-hold capture path is simpler and aligned with product rule that
  mandate guards new exposure, not already reserved funds.
- Mandate state can still be informed after optional existing-hold capture via
  best-effort settlement reporting.
