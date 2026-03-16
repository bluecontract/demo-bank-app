# Solution Design - Summary Projection Pipeline Reliability

## Date

2026-02-08

## Context

Current behavior can freeze visibility when summary generation fails once or when stale async work overwrites newer projection state.

This design introduces a strict two-stage processing model:

1. webhook persists core source-of-truth state and immutable versioned summary input immediately,
2. webhook enqueues a small FIFO pointer message,
3. FIFO worker resolves that pointer, generates summary, and writes projection state conditionally.

References:

- `docs/problem-exploration/013-summary-projection-pipeline-reliability.md`
- `docs/requirements/013-summary-projection-pipeline-reliability.md`

## Proposed Architecture

```mermaid
flowchart LR
  W["Webhook Handler"] -->|"1) write core state"| C["Core Contract Store (Dynamo)"]
  W -->|"2) write immutable summary input version"| V["Summary Input Version Store (Dynamo)"]
  W -->|"3) enqueue pointer job (FIFO, group=documentId)"| Q["SQS FIFO: contract-summary-jobs"]
  Q -->|"4) ordered consume"| S["Summary Worker"]
  S -->|"resolve pointer -> read summary input version"| V
  S -->|"generate summary"| L["Summary Generator"]
  S -->|"5) conditional projection write"| P["Projection Items (USER#/HOLD#/TX)"]
  P -->|"6) list/details read model"| API["Contracts API/UI"]
  D["DLQ"] <-. "max retries / poison" .- Q
```

## Component Responsibilities

| Component                           | Responsibility                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Webhook handler                     | Validate event, resolve canonical identity, persist core state, enqueue summary job, return success quickly.                                    |
| Core contract store                 | Source of truth for latest contract snapshot and source version metadata (`sourceUpdatedAt`, epoch).                                            |
| Summary input version store         | Immutable summary input snapshots keyed by canonical contract identity + source version.                                                        |
| SQS FIFO queue                      | Serialize summary jobs per contract stream and provide retry + DLQ behavior with lightweight pointer payloads.                                  |
| Summary worker                      | Resolve pointer to exact summary-input version, generate summary for that change, apply conditional projection write, manage not-ready retries. |
| Projection store (`USER#/HOLD#/TX`) | Customer-visible list/detail projection with summary preview and summary metadata.                                                              |
| DLQ + monitoring                    | Surface permanent failures for alerting and manual/automatic replay.                                                                            |

## Message Contract (Summary Job)

```json
{
  "type": "contract-summary",
  "messageVersion": 1,
  "contractId": "string",
  "documentId": "string",
  "summaryInputKey": "SUMMARY_INPUT#2026-02-08T10:15:30.000Z",
  "sourceUpdatedAt": "2026-02-08T10:15:30.000Z",
  "sourceEpoch": 7,
  "attempt": 0,
  "enqueuedAt": "2026-02-08T10:15:31.000Z"
}
```

Queue semantics:

- `MessageGroupId`: `documentId`.
- Idempotency scope: `contractId + sourceUpdatedAt` (or `contractId + sourceEpoch` when epoch is authoritative).

## Processing Flow

### 1) Webhook fast path

- Resolve canonical contract identity by `documentId`.
- Persist/update core record immediately (latest snapshot + source version).
- Persist immutable summary-input record for that source version.
- Enqueue pointer summary job for canonical identity only.
- Do not write customer projection summary in webhook path.

### 2) Summary worker path

- Resolve FIFO pointer (`summaryInputKey`) and load the exact persisted summary-input version.
- Generate summary from that versioned snapshot so the text reflects the logical change from that event.
- Write projection items with conditional guard:
  - update only when incoming `sourceUpdatedAt/epoch` is newer than stored `summarySourceUpdatedAt/summaryEpoch`.
  - if condition fails, treat as stale job and exit success (no overwrite).

### 3) Not-ready retry policy

When prerequisites for projection are temporarily missing:

- classify as retriable `NOT_READY`,
- keep message in the same FIFO group and retry in place with bounded backoff (example: 5s, 15s, 45s, 120s) by visibility timeout change,
- increment `attempt` in message attributes/payload bookkeeping,
- after max attempts route to DLQ with correlation metadata.

This prevents permanent "success without projection" states.

### 4) Visibility contract

- Existing summary remains visible until a newer one is successfully written.
- UI/API must not clear projection summary preemptively.
- Newer summary becomes visible only after worker writes projection successfully.

## Technology & Frameworks

| Layer         | Choice                                                    | Rationale                                                                      |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Queue         | AWS SQS FIFO                                              | Per-contract ordering and managed retry/DLQ primitives.                        |
| Compute       | AWS Lambda worker                                         | Existing serverless runtime, easy integration with SQS event source.           |
| Storage       | DynamoDB core + summary-input versions + projection items | Matches current architecture and enables deterministic per-version generation. |
| Version guard | Conditional Dynamo write                                  | Prevent stale overwrite without global locks.                                  |

## Security Review

| Vector                    | Mitigation                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| Duplicate/replayed events | FIFO grouping + idempotency key on source version + immutable summary-input version key.   |
| Stale async overwrite     | Conditional projection update using source version guard.                                  |
| Silent data-loss failures | Retriable NOT_READY classification + DLQ + alerting.                                       |
| Sensitive log leakage     | Structured logs with IDs/versions only; avoid full document payload logging at info level. |

## Cost Estimation

| Item                      | Monthly Cost (USD)              | Source                                                   |
| ------------------------- | ------------------------------- | -------------------------------------------------------- |
| SQS FIFO + Lambda retries | Low / usage-dependent           | AWS pricing calculator (to be estimated per env traffic) |
| DLQ storage               | Negligible for normal operation | AWS pricing calculator                                   |

## Risks & Mitigations

- Risk: hot documents can create queue backlog.
  - Mitigation: monitor queue age and scale worker concurrency while preserving FIFO group ordering per `documentId`.
- Risk: growth of immutable summary-input records.
  - Mitigation: TTL/retention policy and optional compaction strategy.
- Risk: retry storm for long-lived not-ready states.
  - Mitigation: bounded backoff, max attempts, DLQ alarms, replay tooling.

## Open Questions

- Whether to persist explicit worker state (`pending/in-progress/succeeded`) for operational dashboards.
- Whether to add an automated DLQ replay tool after prerequisites become available.
