# 010. AI Chat Streaming Strategy (Lambda + API Gateway)

## Status

- 2026-02-04 Proposed

## Context

The AI chat experience calls an LLM to answer questions and prepare contract
operation requests. Streaming token-by-token responses can improve perceived
latency and UX, but it adds infrastructure and local-dev complexity.

The current demo bank backend is a Lambda behind API Gateway (also emulated by
LocalStack in development). Some streaming-related AWS features may not be
supported (or may be partially supported) by LocalStack Community Edition.

### Constraints

- MVP scope does not require streaming.
- The system must remain AWS-first (optimize for real AWS behavior).
- The existing stack already supports non-streaming LLM calls from Lambda.

## Decision

For MVP we will implement AI chat as a synchronous request/response endpoint
returning a single JSON object per user message. The UI will show a typing
indicator while awaiting the response.

Streaming responses are deferred. If/when streaming is added, it will be
implemented behind a separate delivery mechanism (for example a WebSocket API),
and local development can fall back to non-streaming behavior when emulation is
insufficient.

## Consequences

- Lowest implementation risk and smallest surface area for the MVP.
- Works reliably in AWS and in LocalStack-based development without special
  streaming support.
- Keeps the assistant output schema simple and easy to validate.

* No token-level streaming UX; perceived latency depends on end-to-end LLM call
  time.
* Adding streaming later will require additional infra changes and client logic.

## Alternatives Considered

1. **Lambda response streaming (SSE/streamed HTTP response)**

   - Pros: simplest client (HTTP stream), great UX.
   - Cons: depends on specific AWS integration support; likely poor LocalStack CE
     support; may require infrastructure changes (routing, runtime support).

2. **API Gateway WebSocket + token events**

   - Pros: robust streaming model; decouples HTTP request from token delivery;
     good control over backpressure and reconnect behavior.
   - Cons: additional infra, auth, and client complexity.

3. **Polling (“partial response” storage)**

   - Pros: works everywhere, no streaming.
   - Cons: higher backend complexity and worse UX than true streaming.
