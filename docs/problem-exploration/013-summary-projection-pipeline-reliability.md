# Problem Exploration - Summary Projection Pipeline Reliability

## Date

2026-02-08

## Context

The current contract update flow mixes core state writes and summary projection updates in a way that can hide contracts from the customer list when summary generation fails once or runs out of order.

We want a deterministic pipeline where webhook processing immediately persists core state and a versioned summary-input snapshot, then summary/projection is produced asynchronously and safely. The customer should keep seeing the last valid summary until the newer one is ready.

## Stakeholders & Personas

- Bank customer — expects proposal/contract visibility to be stable and never disappear after acceptance.
- Backend engineer — needs deterministic, idempotent processing under bursty webhook traffic.
- On-call/SRE — needs failures to be retryable and visible (not silently frozen forever).

## Scope / Use-Case Scenarios

1. _When a webhook update arrives, the system should persist core contract data immediately as source of truth before any summary work starts._
2. _When a webhook update is persisted, the system should also persist an immutable summary-input version and enqueue only a small FIFO pointer message to that version._
3. _When multiple updates for the same document arrive close together, the system should process summary jobs in order and prevent stale jobs from overwriting newer projection data._
4. _When projection prerequisites are temporarily missing ("not ready"), the worker should retry with backoff and eventually move to DLQ instead of ending in a permanent hidden state._
5. _When a new summary is not ready yet, users should still see the previous valid summary on lists/details instead of blank/missing entries._
6. _When non-canonical sessions emit equivalent events, they should not produce extra summary/projection writes; canonical document identity remains the source of truth._

## Constraints & Assumptions

- Core source of truth remains Dynamo read model keyed by canonical contract identity (`documentId` dedupe already in place).
- Summary processing must be asynchronous and ordered per contract/document.
- Summary input must be versioned and immutable per source version (`sourceUpdatedAt`/epoch), and FIFO messages should carry only a reference to that version.
- Projection writes (`USER#`, `HOLD#`, `TX#`) are eventual and must be monotonic by source version (`sourceUpdatedAt`/epoch).
- LocalStack and AWS environments must both support the same logical flow.
- We prefer no disruptive migration in this iteration; focus is reliability and idempotency of existing flow.
