# Solution Design - Payment Mandate Reliability + Voucher/Subscription Alignment

## Date

2026-02-13

## Goal

Align bank behavior with product intent for:

- voucher cashback flow funded by merchant hold and paid in partial captures,
- subscription flow with repeated monthly charges protected by one Payment Mandate pool,
- deterministic Payment Mandate orchestration under webhook lag/retries.

## Scope of this alignment

In scope:

- charge request semantics and response timing,
- Payment Mandate identity resolution and async reliability,
- explicit Payment Mandate definition for missing-id requests,
- voucher and subscription orchestration correctness.

Out of scope:

- `Conversation/Customer Consent` document lifecycle (deferred),
- scheduler/time automation for subscription cycles (manual trigger remains enough).

## Confirmed product decisions

1. Voucher init uses authorize-only reverse charge:
   - `PayNote/Reverse Card Charge Requested`
   - not `PayNote/Reverse Card Charge and Capture Immediately Requested`.
2. Voucher hold represents reserved payout pool.
3. Voucher captures are partial and can happen repeatedly from that hold.
4. Payment Mandate is additional protection layer for operations that create new
   exposure (new holds/charges), with optional reporting for existing-hold
   capture.
5. Bank must not emit accepted mandate-gated charge response until Payment
   Mandate authorization is actually confirmed.

## Current mismatches to fix

1. Bootstrap response session id is currently treated as Payment Mandate session
   id in pending-action outcome storage, which is not guaranteed correct for
   async bootstrap lifecycle.
2. Charge flow still uses hardcoded polling window as a decision gate.
3. Missing `paymentMandateDocumentId` path currently infers Payment Mandate defaults
   (`amountLimit = request amount`) instead of consuming explicit definition.
4. Voucher tests currently validate reverse immediate-capture path, not
   authorize-only hold-first path.
5. Capture path does not distinguish existing-hold capture from new-exposure
   requests, so mandate applicability is inconsistent.

## Target behavior

### A) Card charge request lifecycle

1. Bank receives linked/reverse charge request and dedupes by
   `(webhookEventId, emittedEventIndex)`.
2. Bank evaluates applicability:
   - new exposure request (linked/reverse/new reserve) -> mandate required,
   - existing-hold capture -> mandate optional.
3. For mandate-required requests, bank validates `paymentMandateDocumentId`:
   - missing id -> reject,
   - document not found/inactive/revoked/policy mismatch -> reject.
4. For mandate-required requests, bank emits
   `PayNote/Payment Mandate Spend Authorization Requested`.
5. After authorization is confirmed:
   - emit `PayNote/Card Charge Responded` with `status: accepted`,
   - execute reserve (and optional capture-immediate only for relevant event types),
   - emit `PayNote/Card Charge Completed`.
6. If Payment Mandate authorization is rejected:
   - emit `PayNote/Card Charge Responded` with `status: rejected` and reason.
7. Existing-hold capture path:
   - execute capture regardless of mandate presence,
   - if mandate id exists, send settlement report best-effort,
   - failed mandate report does not roll back successful capture.
8. If linked paynote payload exists, startup response stream remains separate:
   - `PayNote/Linked PayNote Start Responded|Started|Failed`.

### B) Payment Mandate orchestration reliability

1. Payment Mandate identity source of truth is final linked identity:
   - `paymentMandateDocumentId` + resolved `paymentMandateSessionId`.
2. Bootstrap response session is tracked separately as
   `paymentMandateBootstrapSessionId` and must not be treated as final session.
3. No decision-critical fixed polling window.
4. Retry policy for technical failures:
   - transient Payment Mandate fetch/operation failures are retried,
   - terminal timeout/retry exhaustion returns explicit technical reject reason.
5. `authorizationId` is preferred correlation key across authorization ->
   settlement (`chargeAttemptId` retained as legacy alias).

### C) Explicit Payment Mandate bootstrap flow

When contract has no `paymentMandateDocumentId`, it must request Payment Mandate
creation explicitly using `Conversation/Document Bootstrap Requested` with
`document.type = PayNote/Payment Mandate` and a template:

- `amountLimit`, `currency`,
- `expiresAt` (optional),
- `sourceAccount`,
- `allowedPaymentCounterparties` (optional, wildcard when missing),
- `allowLinkedPayNote`,
- `allowedPayNotes` (optional, wildcard when missing).

Bank bootstraps Payment Mandate from this definition exactly and then emits
`PayNote/Payment Mandate Attached` to the requesting PayNote.

### D) Voucher and subscription contract intent

Voucher:

1. Root card-txn paynote emits reverse authorize-only request with Payment Mandate and
   attached voucher paynote.
2. Bank reserves hold using reverse direction in emitting-contract context (`payeeChannel -> payerChannel`) and starts linked voucher.
3. Voucher requests monitoring; reports trigger partial captures against hold.
4. Capture path validates Payment Mandate policy before each capture (double protection).

Subscription:

1. Root/child contract emits linked charge requests per cycle.
2. Reuses one Payment Mandate pool with explicit limit and expiry.
3. Each cycle reserve/capture decision is constrained by Payment Mandate remaining allowance.

## Implementation work packages

WP-1 Payment Mandate identity + async reliability fix:

- remove bootstrap-session-as-Payment-Mandate-session assumption,
- replace decision-critical polling gate with async/retry-safe orchestration.

WP-2 Charge response semantics fix:

- remove charge-level `pending` status,
- emit `accepted` only when authorization is confirmed and execution is starting.

WP-3 Explicit Payment Mandate definition support:

- extend Payment Mandate bootstrap request schema/template,
- bootstrap Payment Mandate from requested definition,
- emit `PayNote/Payment Mandate Attached|Attachment Failed` to contract.

WP-4 Voucher authorize-only flow alignment:

- adjust voucher examples/tests to reverse authorize-only path,
- verify hold-first then partial capture behavior.

WP-5 Applicability matrix + capture optional-report path:

- enforce mandate gating only for new exposure requests,
- support existing-hold capture without mandate requirement,
- when existing-hold capture has mandate id, report settlement best-effort
  without affecting capture outcome.

WP-6 Test matrix expansion:

- voucher success/failure matrix,
- subscription success/failure matrix,
- lag/retry technical-failure matrix for Payment Mandate resolution/authorization.

## Acceptance criteria

1. Voucher flow passes with authorize-only root reverse charge and repeated
   partial captures from one hold.
2. Subscription can run repeated cycles under one Payment Mandate limit without
   implicit Payment Mandate inference.
3. For mandate-required requests, bank never emits accepted charge response
   before Payment Mandate approval.
4. Technical Payment Mandate failures are surfaced as bank-technical rejects
   (clear reason), not Payment Mandate-policy rejects.
5. Webhook lag/retries do not cause duplicate execution or inconsistent Payment Mandate totals.
