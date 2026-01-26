# Research - blue-labs-frontend “Document UI” (Lessons for Demo Bank Summaries)

## Date

2026-01-20

## What exists in blue-labs-frontend

The MyOS frontend includes an AI-driven “Document UI” feature that generates a user-facing representation from a document state:

- Client component: `blue-labs-frontend/apps/myos-blue/src/features/generative-ui/document-ui/components/document-ui.tsx`
- React hook: `blue-labs-frontend/apps/myos-blue/src/lib/ai/document-ui-content.ts`
- API route: `blue-labs-frontend/apps/myos-blue/src/app/api/document/ui-content/route.ts`
- System prompt template (Liquid): `blue-labs-frontend/apps/myos-blue/src/app/api/document/ui-content/document-ui-system.prompt.liquid`
- Prompt builder: `blue-labs-frontend/apps/myos-blue/src/app/api/document/ui-content/document-ui-system.ts`
- Template selection rules: `blue-labs-frontend/apps/myos-blue/src/features/generative-ui/templates/engine.ts`

## Architecture pattern used

The feature combines three critical ideas:

1. **Rules-based prompt selection**

   - A rules engine selects type-specific instructions based on document facts (e.g., `type` / `llmType`).
   - Falls back to generic instructions when no rule matches.

2. **A large, explicit system prompt**

   - Strong guardrails: “use only facts present”, avoid internals, filter actions by user channel, avoid duplicate actions.
   - Clear ordering of content and layout constraints.
   - Delimited input payloads (document state, pending operations, activity feed).

3. **Schema-constrained generation**
   - Uses `ai` SDK `streamObject` with a Zod schema (`generativeUIContentCompactSchema`).
   - Produces a stable JSON output structure consumed by the UI renderer.

## Why it is relevant to Demo Bank

This feature demonstrates patterns we can reuse for contract summaries:

- Keep the output structure stable via schema validation.
- Keep the prompt “data-first”, with explicit non-hallucination rules.
- Use per-document-type instruction templates for better accuracy.
- Treat document payloads as data; never allow in-document text to override system rules.

## Why it is not sufficient “as-is”

The MyOS “Document UI” task is broader than Demo Bank’s needs:

- It generates a full UI layout (tables, links, actions), which is inherently open-ended.
- It can be “unstable” because small document changes can cause large layout changes.

For Demo Bank we want a narrower goal:

- A **predictable summary** of “what this contract is and its current state”.
- A constrained set of fields (title, short summary, state explanation, key facts).

## Key lessons to apply

1. **Use type-specific templates**

   - For PayNote vs PayNote Delivery, a single generic prompt will produce inconsistent results.
   - Per-type templates should explain: what the contract represents, what statuses mean, which fields are authoritative.

2. **Separate extraction from narration**

   - The MyOS prompt sends the full JSON document state.
   - For high precision, Demo Bank should deterministically extract key facts first (via Blue schemas) and only ask the LLM to narrate those facts.

3. **Cache generated outputs**

   - MyOS dev route writes prompts to disk in development.
   - Demo Bank should cache summaries by a stable document version (e.g., `updatedAt` or a content hash) to avoid recomputation and UI jitter.

4. **Prefer small schemas**
   - A compact output schema reduces variance and simplifies rendering.
