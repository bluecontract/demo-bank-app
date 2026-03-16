# Requirements Specification - Summary Projection Pipeline Reliability

## Date

2026-02-08

## Inputs

- Problem exploration: `docs/problem-exploration/013-summary-projection-pipeline-reliability.md`

## Functional Requirements

| ID       | Requirement                                                                                                                                                                                                                | Priority |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-SP-1  | Webhook handler MUST persist core contract data immediately (source of truth) before any summary/projection logic.                                                                                                         | Must     |
| FR-SP-2  | For every source update, webhook handler MUST persist an immutable versioned summary-input record keyed by canonical contract identity + source version (`sourceUpdatedAt`/epoch).                                         | Must     |
| FR-SP-3  | Webhook handler MUST enqueue summary work to SQS FIFO with a small pointer payload (identifiers + summary-input version reference), grouped per contract identity to preserve in-order processing for one contract stream. | Must     |
| FR-SP-4  | Summary worker MUST load the exact persisted summary-input version referenced by the FIFO message and generate summary for that specific change.                                                                           | Must     |
| FR-SP-5  | Projection data (`USER#`, `HOLD#`, `TX#` records) MUST be written only by the summary worker, not by webhook fast path.                                                                                                    | Must     |
| FR-SP-6  | Projection write MUST be conditional using source version (`sourceUpdatedAt` and/or epoch), so older jobs cannot overwrite newer projection data.                                                                          | Must     |
| FR-SP-7  | Until a new summary is successfully persisted, previously stored summary MUST remain visible in API/UI.                                                                                                                    | Must     |
| FR-SP-8  | If worker detects "not ready" prerequisites for projection, it MUST retry with backoff and MUST NOT end as permanent success.                                                                                              | Must     |
| FR-SP-9  | After max retry attempts, message MUST be routed to DLQ with full correlation context for manual/automatic recovery.                                                                                                       | Must     |
| FR-SP-10 | Summary processing idempotency MUST be scoped to source version (for example `contractId + sourceUpdatedAt/epoch`) so one failed attempt cannot block future retries forever.                                              | Must     |
| FR-SP-11 | Contract and delivery summary processing MUST run only for canonical session/identity; non-canonical sessions may update dedupe mapping but MUST NOT enqueue duplicate projection work.                                    | Must     |

## Non-Functional Requirements

| ID       | Category         | Requirement                                                                                | Metric/Target                                                                            |
| -------- | ---------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| NFR-SP-1 | Consistency      | Projection visibility must be monotonic per contract stream.                               | 0 stale overwrite incidents after conditional-write rollout                              |
| NFR-SP-2 | Reliability      | Temporary summary/projection failures must self-recover or surface in DLQ.                 | 100% failed jobs either succeed on retry or land in DLQ with alert                       |
| NFR-SP-3 | Ordering         | Updates for one contract stream must be serialized.                                        | FIFO group ordering by `documentId`/canonical `contractId`                               |
| NFR-SP-4 | UX latency       | New summary should appear quickly while preserving old summary during processing.          | P95 core-write-to-projection ≤ 30s in local env                                          |
| NFR-SP-5 | Observability    | Every job must be traceable end-to-end.                                                    | Logs include `documentId`, `contractId`, `sessionId`, `sourceUpdatedAt/epoch`, `attempt` |
| NFR-SP-6 | Operability      | Retry policy should be deterministic and bounded.                                          | Backoff schedule documented and enforced (e.g. 5s, 15s, 45s, 120s, then DLQ)             |
| NFR-SP-7 | Queue efficiency | FIFO messages should carry pointer metadata only (no full summary input snapshot payload). | Queue payload remains lightweight and stable under burst traffic                         |

## Acceptance Criteria

- Webhook processing path writes core data and immutable versioned summary-input records, then enqueues pointer metadata; no direct projection summary updates in fast path.
- FIFO queue receives one ordered stream per contract identity, and burst updates do not create out-of-order projection writes.
- Worker resolves message pointer to an exact stored summary-input version and uses that version for generation.
- Worker applies conditional projection write and refuses stale overwrite when a newer `sourceUpdatedAt/epoch` is already stored.
- During summary regeneration, API/UI still serves previous valid summary instead of hiding contract/proposal.
- For simulated "not ready" state, worker retries with configured backoff and eventually succeeds when prerequisites appear.
- For persistent "not ready" or repeated failures, message lands in DLQ and is observable with correlation identifiers.
