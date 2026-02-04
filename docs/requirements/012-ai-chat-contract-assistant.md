# Requirements Specification - AI Chat Contract Assistant (Demo Bank)

## Date

2026-02-04

## Inputs

- Problem exploration: `docs/problem-exploration/012-ai-chat-contract-assistant.md`
- Base prompt reference: `docs/research/bank-ai-prompt.md`
- UI design (Figma): https://www.figma.com/design/Qb1SKBGi7RwmWWIuj8G86Z/Bank-demo-app?node-id=163-26471&m=dev

## Functional Requirements

| ID       | Requirement                                                                                                                                                                                                                                                                                                                                                                               | Priority |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-AI-1  | The web app provides a “Talk with AI” entry point on the contract card (existing mocked affordance) and opens an AI chat drawer/modal scoped to the selected contract session.                                                                                                                                                                                                            | Must     |
| FR-AI-2  | Chat state is scoped to a single contract session view and is ephemeral (client-only). Closing the chat clears the conversation; no server-side persistence is required for MVP.                                                                                                                                                                                                          | Must     |
| FR-AI-3  | The assistant answers user questions about the contract using the current contract session’s document state as ground truth. The system must not invent contract fields, operations, channels, or state not present in that document.                                                                                                                                                     | Must     |
| FR-AI-4  | The assistant can list “eligible operations” available to the user. The eligible set is derived from root document contracts of type `Conversation/Operation` and filtered by the configured operations channel key for the contract (including membership via composite channels).                                                                                                       | Must     |
| FR-AI-5  | The assistant supports only eligible operations. If the user requests an ineligible/unknown operation, the assistant refuses and provides a safe alternative (for example, listing eligible operations).                                                                                                                                                                                  | Must     |
| FR-AI-6  | When the user requests an eligible operation, the assistant collects required input parameters (if any) via a conversational flow and provides a payload preview/summary before execution.                                                                                                                                                                                                | Must     |
| FR-AI-7  | Every operation execution requires explicit user confirmation in the UI before invoking the operation API. The assistant must not cause an operation to run without confirmation.                                                                                                                                                                                                         | Must     |
| FR-AI-8  | On confirmation, the web app invokes `POST /v1/contracts/:sessionId/:operation` with the collected payload (or `{}` for no-input operations), then refreshes the contract details and reflects the outcome in the chat.                                                                                                                                                                   | Must     |
| FR-AI-9  | The assistant’s server response uses a strict, machine-readable schema that can express: (a) a normal answer, (b) a request for one missing detail, or (c) readiness to execute an operation with an `operationRequest`.                                                                                                                                                                  | Must     |
| FR-AI-10 | The assistant may suggest UI focus to guide the user (for example, highlighting relevant document paths/sections/contracts) when answering or preparing an operation_toggle, but must remain compatible when the UI ignores it.                                                                                                                                                           | Should   |
| FR-AI-11 | The eligible operations filter must match the existing operations UI behavior: operations with no `channel` are not shown; operations are eligible when (a) `operation.channel` equals the configured operations channel key, OR (b) `operation.channel` references a `Conversation/Composite Timeline Channel` that includes the configured operations channel key (directly or nested). | Must     |

## Non-Functional Requirements

| ID       | Category      | Requirement                                                                                                                 | Metric/Target                           |
| -------- | ------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| NFR-AI-1 | Safety        | Operation execution is restricted to the eligible operations set and always gated by explicit user confirmation.            | 100% executions confirmed; 0 bypasses   |
| NFR-AI-2 | Correctness   | The assistant’s outputs are schema-validated and parseable by the host app (no free-form text-only responses from the API). | 0 schema parse failures in normal usage |
| NFR-AI-3 | Resilience    | If the LLM call fails or returns invalid output, the UI shows a safe error and allows retry without breaking the page.      | No uncaught exceptions in UI            |
| NFR-AI-4 | Performance   | Chat responses return fast enough to feel interactive for end users.                                                        | P95 end-to-end ≤ 8s (local dev)         |
| NFR-AI-5 | Compatibility | Operation eligibility and request schemas are derived using the Blue runtime and repository contracts to avoid drift.       | No type mismatches vs operations UI     |
| NFR-AI-6 | Observability | The backend logs chat invocation outcomes (success/failure) and operation execution attempts without logging secrets.       | Structured logs for 100% requests       |

## Acceptance Criteria

- “Talk with AI” is accessible from the contract card and opens a chat UI matching the approved design intent.
- Chat messages can answer “what is this contract about?” grounded in the current document state.
- Asking “what ops can I do?” lists only eligible operations (same filter rules as the operations UI).
- Requesting an eligible operation triggers a collect → confirm → execute flow, including a payload preview and explicit confirmation.
- The app executes the operation via `POST /v1/contracts/:sessionId/:operation`, refreshes the contract, and reports success/failure in the chat.
- Requesting an ineligible/unknown operation is refused safely (no API call).
- Chat history does not persist across close/reopen for MVP.
