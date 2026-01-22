# Research (v2) - Behavior-Aware Blue Contract Summaries

## Date

2026-01-21

## Why v2

The v1 “extract → narrate” approach (facts-only) is good for stability, but it cannot answer questions that depend on **contract behavior**:

- What will happen if a participant invokes an operation now?
- Which participant is allowed to do what?
- How does the document evolve in response to events (workflows, handlers)?
- How did we arrive at the current state (triggering + emitted events)?

Examples like “first accepter gets $50, second gets $30” require understanding the **logic encoded in the `contracts` section** (operations + handlers), not just the current state fields.

## Where behavior lives in Blue documents

In Blue, behavior is encoded as contracts (usually under the document’s root `contracts` map):

- **Channels** are entry points for events into a scope.

  - Core: `Core/Channel`
  - Conversation: `Conversation/Timeline Channel`
  - MyOS-specific: `MyOS/MyOS Timeline Channel`

- **Operations** define user-/participant-invokable actions.

  - `Conversation/Operation`
  - Key fields:
    - `request`: request schema (any Blue node)
    - `channel`: contracts-map key of the channel used to invoke it

- **Handlers / workflows** implement behavior when events arrive on a channel.

  - `Core/Handler`
  - `Conversation/Sequential Workflow`
  - `Conversation/Sequential Workflow Operation` (binds a `Conversation/Operation` to a workflow implementation)
  - Note: workflows may also be bound to **lifecycle channels** (initialization) or other non-operation channels.

- **Sequential workflow steps** encode most of the domain logic.
  - `Conversation/JavaScript Code`
  - `Conversation/Update Document`
  - `Conversation/Trigger Event`

## What a “behavior-aware summary” needs as input

To produce a human-readable explanation that tracks “what this contract does” and “what you can expect if you do X now”, the summarizer needs:

1. **Current state** (selected, canonical facts)

   - The same v1 “facts” object, but expanded to include any fields that matter for availability/outcomes.

2. **Behavior definition** (contracts map digest)

   - Operations + their allowed channels/participants (when operations exist).
   - **All workflows/handlers that affect state**, including:
     - operation implementations (`Sequential Workflow Operation`)
     - initialization workflows (bound to lifecycle channels)
     - event-driven workflows that react to events emitted by other workflows
   - A compact “flow graph” view:
     - which channels/handlers can trigger which state changes
     - which steps emit which event types
     - which event types can be consumed by which handlers (when matchers exist)

3. **Transition context** (recent events)

   - `triggerEvent`: what caused the last transition.
   - `emittedEvents`: what the contract emitted in response.
   - (Optional) a diff between previous and current state, if we store it.

4. **Schema context** (type semantics without “resolved docs”)
   - The LLM needs to know what “Operation”, “Sequential Workflow”, “Update Document”, “Trigger Event”, etc. mean.
   - It also needs the domain type definition (e.g., PayNote Delivery) to interpret state fields.

## “Do not pass resolved documents” (how to still provide schema meaning)

Resolved documents are bloaty because they inline lots of type metadata repeatedly.

Instead, build a **Type Definition Pack** alongside the compact document digests:

- **Type Definition Pack idea**

  - Provide a dictionary of _type cards_ for the types that appear in:
    - the root document (`type`)
    - root `contracts/*` entries (`type`)
    - recent `triggerEvent.type` and `emittedEvents[*].type`
  - Each type card contains:
    - `typeName`
    - short `description`
    - direct field names + descriptions (one level deep)

- **Source of type cards**

  - Prefer the **distributed repository package** `@blue-repository/types`:
    - It ships machine-readable “contents” objects per type (name + description + field metadata) and the Zod schemas used for validation.
    - This keeps Demo Bank aligned with what it already uses at runtime (`@blue-labs/language` + `@blue-repository/types`) and avoids coupling to the local mono-repo’s `blue-repository/**` sources.
  - Build type cards from:
    - `@blue-repository/types/packages/*/contents/*` (human-readable descriptions + field descriptions)
    - optionally `@blue-repository/types/packages/*/schemas/*` (for shape/field enumeration when contents are missing)
  - v2 baseline: do not trim; optimize later if needed.

- **Baseline v2 input to send (no semantic trimming)**
  - `document_simple`: full current document in Blue “simple” form, **including all `contracts`**.
  - `transition_events`: full `triggerEvent` + `emittedEvents` (also “simple”).
  - `definitionsByBlueId`: a de-duplicated “Type Definition Pack” keyed by `type.blueId`:
    - type definitions from `@blue-repository/types` (`packages/*/contents/*`) for all referenced `type.blueId`s (plus their dependencies).
  - `typeNameByBlueId`: alias map via `getTypeAliasByBlueId` for readability.

Critical constraint for v2 baseline:

- Do not send **non-type** Blue node references of the shape `{ "blueId": "..." }` to the model.
- The payload must be self-contained: `{ "blueId": "..." }` objects are allowed only in type-reference fields (`type`, `itemType`, `keyType`, `valueType`).
- If such non-type stubs are present in `contracts` or in transition events, surface an explicit error and do not generate a summary.

This avoids the biggest source of bloat (resolved document duplication) while keeping the model grounded in schema semantics and current state/transition context.

## Minimizing prompt size while preserving “flow”

Behavior can still be large (especially JS code steps). A practical approach:

If prompt size becomes a practical issue, add an optimization layer (later; not the baseline v2 approach):

- **Event-graph slicing** (not only operations):

  - Seed the slice with:
    - user-invokable operations (if role/channel is known)
    - lifecycle/initialization handlers (e.g., “document processing initiated”)
    - the most recent `triggerEvent.type` and `emittedEvents[*].type`
  - Expand to include:
    - workflows/handlers bound to the seeded channels
    - workflows/handlers whose matchers accept the seeded event types
    - any events emitted by included workflows, up to a bounded depth
  - Result: the model can explain chains like “Operation → emits event → triggers workflow → updates state”.

- For `Conversation/Update Document` steps:

  - Include the `changeset` entries; they are structured and compact.

- For `Conversation/Trigger Event` steps:

  - Include the event payload shape, but strip large nested blobs.

- For `Conversation/JavaScript Code` steps:
  - Treat code as **untrusted data**.
  - Consider including:
    - the full code (when short), OR
    - a safe digest: extracted document paths read/written and event types mentioned.

## Security considerations (critical)

- Never execute contract JavaScript locally (documents are untrusted; MyOS runs code in a sandbox).
- Treat all strings from the document and contract code as untrusted inputs.
- Apply the same prompt injection posture used in Demo Bank’s existing LLM usage:
  - Delimit untrusted blocks.
  - Explicitly instruct the model to ignore instructions inside data/code blocks.
  - Constrain outputs to a strict schema.

## What this enables (the “voucher example”)

With:

- full `contracts` + the Type Definition Pack (so the workflow logic is available), and
- transition events showing whether someone already accepted,

the summarizer can produce an evolving explanation such as:

- “If you accept now, you receive $50; if second, $30.”
- After an update: “$50 is already claimed; accepting now yields $30.”

The key is that the summary is grounded in:

- the workflow logic (how it assigns vouchers), and
- the state/event history (what already happened).

## Concrete example: PayNote Delivery → PayNote bootstrap request

PayNote Delivery is a good v2 example because the “main thing” to explain is not just its current status, but the **behavioral consequence** of accepting:

- The delivery document embeds a PayNote proposal (the PayNote document is included in the delivery document).
- The accept workflow can emit a `Conversation/Document Bootstrap Requested` payload (the embedded “bootstrap request”) when acceptance is valid.
- In Demo Bank, that emitted bootstrap request leads the bank to bootstrap (create) the PayNote document/session.

A behavior-aware summary should therefore highlight:

- what PayNote is proposed (key facts from the embedded PayNote),
- that accepting triggers bootstrapping/starting that PayNote (grounded in emitted events),
- and how this changes once acceptance has already been recorded.
