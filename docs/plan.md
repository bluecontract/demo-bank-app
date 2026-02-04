# Implementation Plan - AI Chat Contract Assistant (Demo Bank)

## Date

2026-02-04

## Purpose

Deliver an AI chat experience for a contract session that:

- answers questions grounded in the current contract document,
- lists only eligible contract operations (same filter as existing operations UI),
- guides the user through operation inputs,
- requires explicit confirmation before execution,
- executes via the existing contract operation API and surfaces asynchronous updates.

This plan is optimized for Codex-driven implementation and targets real AWS
behavior first (Lambda + API Gateway). Streaming is explicitly deferred (ADR
010); the MVP is request/response with a UI “typing / processing” state.

## Scope / Deliverables

- `bank-api-contract`: add `POST /v1/contracts/:sessionId/ai-chat` request/response schemas.
- `bank-api`: implement AI chat handler (auth-gated to contract owner) with structured LLM output parsing + server-side guardrails (eligible ops allowlist).
- `bank-web-app`: implement “Talk with AI” drawer/modal (Figma) with ephemeral chat state, confirmation gating, and “processing…” UX that waits for webhook-updated contract snapshots.
- Tests: backend handler unit tests, UI component tests, and minimal shared-schema coverage.

Out of scope (MVP):

- token streaming (SSE/WebSocket),
- server-side chat persistence,
- non-eligible operation discovery/execution,
- cross-session/global AI features.

## Milestones

1. Shared API contract + DTO schemas
2. Backend AI chat endpoint (prompt + OpenAI integration)
3. Web chat UI (Figma) + status handling
4. Operation execution UX (confirm + processing + polling)
5. Tests + verify + code review

## Implementation Steps

### 1) Shared contract: define AI chat API shapes

Files:

- `libs/shared/bank-api-contract/src/lib/schemas.ts`
- `libs/shared/bank-api-contract/src/lib/bank-api-contract.ts`
- `apps/bank-web-app/src/types/api.ts` (if generated/hand-maintained needs sync)

Work:

- Add DTOs:
  - `ContractAiChatMessageDto` (`role`, `content`)
  - `ContractAiChatRequestDto` (`messages[]`, bounded)
  - `ContractAiChatOperationRequestDto` (matches `Conversation/Operation Request`)
  - `ContractAiChatResponseDto` (matches `docs/research/bank-ai-prompt.md`)
- Add `POST /v1/contracts/:sessionId/ai-chat` to the ts-rest contract under `banking`.
- Add lightweight response invariants in runtime code (e.g. `operationRequest` only when `status="ready"`).

### 2) Shared logic: eligible operations + request models (avoid drift)

Goal: reuse the same eligibility rules for UI and AI server-side context.

Work (preferred):

- Extract the existing operation discovery filter from
  `apps/bank-web-app/src/features/contracts/lib/operations.ts` into a shared
  library (e.g. `libs/shared/bank-api-contract` or `libs/contracts`) that both
  `bank-web-app` and `bank-api` can import.
- Reuse (or extract) the request schema → compact “field model” builder from
  `apps/bank-web-app/src/features/contracts/lib/operationFormModel.ts` so the
  server can supply the LLM with a stable, compact request shape per operation
  (instead of dumping the full type repo summary).

If extraction is too invasive, duplicate the minimal logic in `bank-api` but add
tests to lock parity with the UI behavior.

### 3) Backend: implement AI chat handler (non-streaming)

Files:

- `apps/bank-api/src/contracts/aiChat.ts` (new)
- `apps/bank-api/src/contracts/aiChatPrompts.ts` (new)
- `apps/bank-api/src/main.ts` (wire handler)

Work:

- Auth-gate by contract ownership (same pattern as `getContractDetails`).
- Load contract record by `sessionId` and use `contract.document` as ground truth.
- Compute supported contract metadata (type registry) and eligible operations.
- Build LLM input:
  - `actorChannel` (operations channel key),
  - eligible operations list + request models,
  - current document (YAML or JSON; treat as untrusted data in prompt),
  - bounded chat history.
- Call OpenAI using the existing pattern from summary generation:
  - `client.responses.parse(...)` + `zodTextFormat(ContractAiChatResponseDto, ...)`
  - bounded timeout (new env var, e.g. `CONTRACT_AI_CHAT_TIMEOUT_MS`, default to 45s).
- Enforce server-side guardrails on the parsed output:
  - if `status="ready"`, require `operationRequest.operation` to be in eligible operations; otherwise downgrade to `cannot_do`.
  - if `status!="ready"`, strip `operationRequest` if present.
- Logging/observability:
  - log counts and statuses (not raw chat content or full documents).

### 4) Frontend: implement chat drawer/modal + API hook

Files (names indicative; align to repo conventions during implementation):

- `apps/bank-web-app/src/features/contracts/components/ContractAiChatDrawer.tsx` (new)
- `apps/bank-web-app/src/features/contracts/hooks/useContractAiChat.ts` (new)
- Contract card integration point (post-rebase; hook existing mocked “Talk with AI” CTA)

Work:

- Implement the drawer UI per Figma (`163:26471`):
  - overlay, left-side panel, title + close,
  - message bubbles (assistant/user),
  - input + send button,
  - typing indicator.
- Ephemeral state:
  - keep messages in component state only; clear on close.
  - send bounded history to backend on each user message.
- Response handling:
  - `answer` / `cannot_do`: append assistant message.
  - `needs_more_info`: append the single question and wait for next user response.
  - `ready`: render a confirmation card (show operation name + payload preview) and require explicit confirm.
- Execution:
  - on confirm, call existing `useRunContractOperation`.
  - after the operation request succeeds, show “processing…” and wait for the
    webhook-updated contract snapshot:
    - poll `GET /v1/contracts/:sessionId` until `updatedAt` changes (bounded timeout),
    - then append an outcome message.
  - do not “immediate refresh” expecting a state change.

### 5) Tests + verification

Backend:

- Unit tests for AI chat handler:
  - rejects non-eligible operation requests (server allowlist),
  - returns `needs_more_info` for missing details (smoke),
  - does not include `operationRequest` unless `status="ready"`.

Frontend:

- Component tests for chat drawer:
  - confirm gating (no operation call before confirm),
  - shows “processing…” and polls contract details (mocked).

Verification:

- Run `npm run verify:quick`.
- Run staged-only code review (skill) before any commits.
