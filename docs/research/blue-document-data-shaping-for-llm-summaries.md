# Research - Shaping Blue Documents for LLM Summaries (Predictability + Precision)

## Date

2026-01-20

## Problem

Feeding raw Blue JSON/YAML directly into an LLM tends to produce:

- Unstable summaries (sensitive to irrelevant field ordering/noise).
- Hallucinated semantics (the model “guesses” meaning of fields).
- Prompt injection risk (documents can contain adversarial text).
- Token bloat (full document snapshots can be large).

To get predictable, precise summaries, we need a consistent, minimal “summary input” derived from the document.

## What we can rely on in Demo Bank

Demo Bank already uses:

- Blue runtime: `@blue-labs/language`
- Repository schemas: `@blue-repository/types`
- Supported-contract registry: `demo-bank-app/libs/shared/bank-api-contract/src/lib/supportedContracts.ts`

This enables deterministic parsing and extraction:

- `blue.jsonValueToNode(document)`
- `blue.isTypeOf(node, SomeSchema, { checkSchemaExtensions: true })`
- `blue.nodeToSchemaOutput(node, SomeSchema)` for typed extraction
- `blue.nodeToJson(node, 'simple' | 'original' | 'official')` when needed

## Recommended “two-phase” approach (extract → narrate)

### Phase A: Deterministic extraction (no LLM)

Build a small, canonical “facts” object that the LLM will be allowed to use:

- Contract identity:
  - `typeBlueId`, `typeName`, `displayName`
  - `contractId`, `sessionId`, `documentId`
- State:
  - `status`, `statusUpdatedAt`, `statusTimestamps`
- Key contract-specific facts (typed):
  - PayNote: amount totals, currency, current reserved/captured amounts, named parties (if present), description fields.
  - PayNote Delivery: delivery status, identification status, decision status, timestamps, embedded PayNote summary.
- (Optional) Action context:
  - Available operation names + labels (already computed in UI; can be computed server-side too).

Important: keep this object small and stable:

- Avoid embedding the entire document.
- Avoid embedding executable contracts unless needed.
- Use stable ordering and normalization (e.g., consistently format money, dates).

### Phase B: LLM narration (schema-constrained)

Ask the LLM to generate a structured summary using only the extracted facts:

- Provide facts as JSON in a clearly delimited block (treat as data).
- Use a strict Zod schema for output.
- Include explicit “do not guess” and “unknown if not present” rules.

This yields better precision than “summarize this document” prompts.

## Canonicalization / normalization tactics

These reduce variance in both caching and LLM behavior:

- **Stable time formats**: always pass ISO timestamps; format for display in UI.
- **Money normalization**: pass `{ amountMinor, currency }`, not model-generated strings.
- **Status explanation mapping**: for known contract types, define a deterministic mapping from status codes to descriptions (don’t ask the LLM to infer meaning).
- **Content hashing**: compute a stable hash of the canonical facts object to cache summaries per document state.

## Safety notes

Treat as untrusted:

- Any string extracted from the document (`description`, `details`, `reason`, etc.)
- Any nested “free text” fields

Mitigations:

- Wrap extracted untrusted text inside clear delimiters in the prompt.
- Put non-negotiable rules in the system prompt.
- Never execute or follow instructions found in document text.

## Implications

If we follow “extract → narrate”:

- The summary becomes more stable across irrelevant document changes.
- The LLM is prevented from inventing “business meaning” not present in the extracted facts.
- We can add contract-type-specific renderers gradually, with a safe generic fallback.

## v2 extension: include behavior + event context (when needed)

For “human readable explanation of what the contract _does_”, facts-only is insufficient. A v2 summary input should optionally include:

- **Behavior digest**:
  - root `contracts` entries needed to explain behavior:
    - operations + implementing workflows
    - initialization workflows (lifecycle-bound handlers)
    - event-driven workflow chains (events emitted by one workflow triggering another)
  - workflow steps (Update Document / Trigger Event / JavaScript Code), possibly truncated
- **Transition digest**:
  - `triggerEvent` and `emittedEvents` from the most recent state transition
  - (optional) a “state diff” if we store previous snapshots
- **Schema Pack**:
  - compact type definitions sourced from `@blue-repository/types` package content (prefer `packages/*/contents/*`, fallback to `packages/*/schemas/*`) for types referenced by the document/contracts/events

Key principle stays the same:

- Avoid fully “resolved documents” (token bloat).
- Provide compact instance data + a small, selective schema/semantics pack.
