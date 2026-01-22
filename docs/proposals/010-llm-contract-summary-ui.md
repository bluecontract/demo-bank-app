# Proposal - LLM Contract Summary UI (Demo Bank)

## Date

2026-01-20

## Problem

The Contracts details view currently renders the stored Blue contract document as raw JSON/YAML (`ContractDetailsPanel`), which is:

- Hard to read for non-technical users.
- Noisy (contracts + type wrappers + nested structures).
- Weak at conveying “what this contract is about” and “what state it is in now”.

We want to display an **LLM-generated summary based on the current state** of the contract, while keeping the existing raw document view available as a fallback/debug tool.

## Related research

- `docs/research/contract-summary-ui-current-implementation.md`
- `docs/research/demo-bank-app-llm-patterns-and-guardrails.md`
- `docs/research/blue-labs-frontend-document-ui-lessons.md`
- `docs/research/blue-document-data-shaping-for-llm-summaries.md`
- `docs/research/paynote-and-paynote-delivery-state-notes.md`

## Goals

- Predictable, precise contract summary and state explanation.
- Strong resistance to hallucinations and prompt injection.
- Fast UI (cached summaries, graceful degradation).
- Works across supported contract types (today: PayNote + PayNote Delivery) and is extensible for future contracts.
- Keep sensitive data exposure minimal (only send required fields to the LLM).

## Non-goals

- Full generative UI rendering (tables, action links, etc.) like MyOS.
- Replacing the existing operation invocation UI.
- Perfect “natural language understanding” of arbitrary contract types without adding type-specific support.

## Inputs and constraints (what we already have)

From the Bank API contract details response (`ContractDetailsDto`):

- Contract identity: `typeBlueId`, `displayName`, `sessionId`, `documentId`
- State: `status`, `statusUpdatedAt`, `statusTimestamps`
- Traceability: `triggerEvent`, `emittedEvents` (present in schema; currently not fully populated)
- Current document snapshot: `document`

Parsing/typing support:

- Blue runtime: `@blue-labs/language`
- Repository schemas: `@blue-repository/types`
- Supported types registry: `demo-bank-app/libs/shared/bank-api-contract/src/lib/supportedContracts.ts`

Existing LLM patterns to reuse:

- Prompt injection delimiters + rules (`parsePayNotePdf.ts`, `openAiValidationProvider.ts`)
- Schema-constrained output parsing via Zod (`openAiValidationProvider.ts`)

Reference implementation (broader scope) in MyOS:

- Rules-based prompt selection + schema-constrained generation (`blue-labs-frontend` document UI)

## Options

### Option A — LLM summarizes the raw contract document (fastest, least predictable)

**How it works**

- Send the full stored `document` JSON/YAML to the LLM and ask for a summary.

**Pros**

- Minimal engineering effort.
- Works “somewhat” for any document.

**Cons**

- Highest hallucination risk (the model infers semantics not present).
- High prompt injection risk (documents contain free-text fields).
- Unstable output (irrelevant document changes can reshape the summary).
- Token-heavy for large documents.

**Best use**

- Internal-only prototypes and exploratory UI, not “predictable and precise” summaries.

---

### Option B — Deterministic renderer only (most predictable, not LLM-generated)

**How it works**

- For each supported contract type, implement a renderer that extracts key fields via Blue schemas and renders a fixed UI summary.
- For unknown types, show a generic “facts table” + raw YAML.

**Pros**

- Maximum determinism and testability.
- Zero hallucination and lower security risk.
- Fast (no external calls).

**Cons**

- Requires ongoing manual work per contract type.
- No “natural language” flexibility unless hand-authored.

**Best use**

- Baseline + fallback mode, even if we adopt an LLM for narration.

---

### Option C — Hybrid “extract → narrate” (recommended)

**How it works**

1. Deterministically extract a small canonical “facts” object from the contract record:
   - Use Blue schemas to produce typed, stable fields.
   - Normalize money/timestamps.
   - Optionally include derived state explanations from a type-specific mapping.
2. Ask the LLM to generate a short, user-facing summary from the facts object only.
3. Constrain output to a strict Zod schema (backend validated).
4. Cache by document version (e.g., `contract.updatedAt` or a content hash of the facts object).

**Pros**

- Much more predictable than raw-document summarization.
- LLM cannot invent key facts because we do not ask it to extract them.
- Easy to expand: add a new extractor + template for new types.
- Safe fallback: if LLM fails, show deterministic facts view or raw YAML.

**Cons**

- More engineering than Option A.
- Requires maintaining extractors (but far less than full renderers).

---

### Option D — Reuse MyOS “generative UI” pipeline (powerful, over-scoped)

**How it works**

- Adopt the blue-labs-frontend approach: rules-based prompt selection + schema-constrained “UI content” generation.
- Render the resulting UI blocks in Demo Bank.

**Pros**

- Rich, user-friendly layouts are possible (tables, links, structured sections).
- Existing internal baseline (prompt + schema patterns) to learn from.

**Cons**

- Overkill for “summary” needs.
- Harder to keep stable (layout variance is a core feature).
- Requires importing/porting a larger runtime (renderers, schema, template engine).

**Best use**

- Future work if Demo Bank wants full “document UX” parity with MyOS; not required for a predictable summary panel.

## Recommended solution (Option C with a deterministic fallback)

### 1) Output contract summary as structured data (not just a blob of text)

Define an API-facing schema (Zod) that is stable and small:

- `title`: short (used as section title)
- `oneLiner`: 1–2 sentence “what this is”
- `state`: `{ statusLabel, explanation, updatedAt? }`
- `keyFacts`: list of `{ label, value }` (money + parties + identifiers)
- `warnings`: list of strings (only when grounded in facts; otherwise empty)

This is the core lever for predictability: the UI renders from structured fields, and we can validate output.

#### Proposed Zod shape (sketch)

Keep this intentionally small:

- `title: string` (max ~80 chars)
- `oneLiner: string` (max ~240 chars)
- `state: { statusLabel: string; explanation: string; updatedAt?: string }`
- `keyFacts: Array<{ label: string; value: string }>` (max 8)
- `warnings?: string[]` (max 5)

If we need richer output later, add it behind versioning (e.g., `schemaVersion: 1`).

### 2) Deterministic extractors per supported contract type

Implement extractors (no LLM) to produce canonical facts:

- PayNote extractor:
  - `status`, `amount.total/reserved/captured`, `currency`
  - `payNoteInitialStateDescription.summary` (as “user-provided description”, not authoritative truth)
- PayNote Delivery extractor:
  - `deliveryStatus`, `transactionIdentificationStatus`, `clientDecisionStatus`
  - `clientAcceptedAt/clientRejectedAt`, `deliveryError`
  - Embedded PayNote summary (name/amount/currency)

Use `@blue-repository/types` schemas via the existing Blue instance to avoid drift.

#### Fact object contract (what the LLM sees)

To minimize hallucinations, the LLM should receive:

- A `contractFacts` JSON object containing only:
  - Identifiers and display labels (non-sensitive)
  - Normalized state (strings + ISO timestamps)
  - Normalized money values already formatted for display (e.g., `"USD 123.45"`)
  - Short, clearly-marked “untrusted text” fields (e.g., user-provided descriptions)

Avoid passing:

- Full `document` payloads (token-heavy + injection surface)
- Raw `contracts` map (unless you explicitly want “available actions” summarized)
- Large historical event logs

### 3) Type-specific templates for narration (small and strict)

For each supported type, provide a compact, “non-hallucination” instruction set similar to MyOS templates:

- Define what the contract represents.
- Define what each state field means (especially for PayNote Delivery’s identification/decision gates).
- Require the model to:
  - Use only fields from the facts object.
  - Mark unknowns explicitly.
  - Avoid any operational advice that is not explicitly supported by state.

#### Prompt injection posture

Even after extraction, treat any free-text fields as untrusted. In the system prompt:

- Explicitly state that `contractFacts.untrustedText.*` may contain malicious instructions.
- Require the model to ignore instructions and use them only as “quoted data”.

### 4) Cache + regeneration strategy

Store the summary with a version key:

- `summaryVersion = hash(facts)` or `(contract.updatedAt, contract.statusUpdatedAt)`

Preferred approach:

- Lazy generation:
  - On `GET /v1/contracts/:sessionId`, return cached summary if present.
  - If missing/stale, return `summary: null` and a `summaryStatus` field (`missing|stale|ready|failed`).
  - Provide `POST /v1/contracts/:sessionId/summary` to (re)generate and persist.

This avoids recomputing summaries on every page load and prevents “UI jitter”.

#### Versioning recommendation

Prefer `summaryVersion = hash(canonicalFacts)` over timestamps:

- `updatedAt` changes for many reasons (including metadata merges).
- A canonical facts hash changes only when summary-relevant content changes.

### 5) Precision guardrails (beyond schema validation)

Schema validation ensures shape, not truth. For precision:

- Pre-format key values (money/date/status labels) in code and provide them as strings the model must reuse.
- Consider including a `sourceOfTruth` section in the prompt:
  - “If `statusLabel` is present, use it exactly.”
  - “Do not restate numeric values unless present in `keyFacts`.”
- (Optional) Add a server-side “consistency check”:
  - Ensure `keyFacts` values are a subset of the provided facts (string match), otherwise drop the offending entries and keep the rest.

### 5) UI changes (ContractDetailsPanel)

- Replace “Contract document” YAML panel with:
  - “Summary” panel (default)
  - “View raw YAML” toggle (secondary)
  - “Regenerate summary” button (optional; useful during development)
- Failure modes:
  - If summary generation fails, show a concise error and default to raw YAML.

### 6) Security and privacy considerations

- The LLM call should be **server-side only**.
- Only send minimal data needed to generate the summary.
- Never pass secrets (MyOS credentials, user IDs, internal Dynamo keys).
- Audit logging:
  - Log summary generation failures + model response metadata (but avoid logging the full prompt in production).

## Implementation sketch (where code would live)

Backend (Bank API / libs):

- Add a `ContractSummary` type + storage fields to `demo-bank-app/libs/contracts/src/application/ports.ts`
- Add a `ContractSummaryGenerator` in `demo-bank-app/libs/contracts/src/application/…`
  - Depends on `@blue-labs/language`, `@blue-repository/types`, and OpenAI client.
  - Uses Zod output parsing (`responses.parse`) like `openAiValidationProvider.ts`.
- Extend contract record persistence in `DynamoContractRepository` to store:
  - `summary` (structured)
  - `summaryUpdatedAt`
  - `summaryVersion`
  - `summaryError` (optional)
- Add endpoints:
  - `POST /v1/contracts/:sessionId/summary` (generate + persist)
  - (Optional) extend `GET /v1/contracts/:sessionId` to include cached summary fields

Frontend (Bank Web App):

- Add a `ContractSummaryPanel` used by `ContractDetailsPanel`.
- Render the structured summary; keep raw YAML behind a toggle.
- Use React Query to call the summary endpoint and cache in-client.

## Example outputs (for UI design and testing)

### PayNote Delivery (example)

- `title`: `PayNote Delivery`
- `oneLiner`: `A PayNote delivery awaiting your decision after the bank identified the card transaction.`
- `state.statusLabel`: `Decision pending`
- `state.explanation`: `The transaction is identified, but no accept/reject decision is recorded yet.`
- `keyFacts`:
  - `PayNote`: `USD 249.00`
  - `Identification`: `Identified`
  - `Decision`: `Pending`

### PayNote (example)

- `title`: `PayNote`
- `oneLiner`: `A commitment of value between payer and payee, secured by a guarantor.`
- `state.statusLabel`: `Reserved`
- `state.explanation`: `Funds are reserved; capture or release will determine final settlement.`
- `keyFacts`:
  - `Total`: `USD 500.00`
  - `Reserved`: `USD 500.00`
  - `Captured`: `USD 0.00`

## Testing strategy

Deterministic extraction (unit tests):

- Given fixture documents, extractors produce stable facts objects.

LLM integration (unit tests with OpenAI stubs):

- Verify prompt builder inputs and model configuration.
- Verify schema parsing and fallback behavior on invalid output.

UI tests:

- Summary panel renders when summary exists.
- Raw YAML toggle works.
- Error state falls back to raw YAML.

## Open questions / follow-ups

- Confirm the intended PayNote Delivery `operationsChannelKey` (`payNoteReceiver` vs `payNoteDeliverer`) to avoid misleading “available operations” and to align summary wording with the actual user role.
- Decide whether summaries should be generated per contract update (webhook-time) or lazily on view.
- Determine retention limits for summary text and whether to store multiple versions (audit) or only latest.
- If the summary must explain contract _behavior_ (workflows, “what happens if…”), adopt the v2 approach in `docs/proposals/011-llm-contract-summary-ui-v2-behavior-aware.md`.
