# Problem Exploration - Document Operations UI (Demo Bank)

## Date

2026-01-15

## Context

The demo bank UI currently hardcodes PayNote Delivery actions. We need a
reusable operations experience that is driven by Blue document contracts so the
bank can surface operations for any document (PayNote Delivery, PayNote, or
future contracts) without new UI wiring.

Operations are defined as `Conversation/Operation` contracts. Each operation can
specify a `request` Blue node (the input shape) and a `channel` contract key that
indicates which participant may invoke it. The UI should display operations only
for the document being viewed (root scope) and filter by a configurable channel
key. For example, PayNote uses `payeeChannel`, while PayNote Delivery uses
`payNoteReceiver`. Operations without a `channel` are hidden by default.

The bank also maintains an explicit registry of supported contract types. This
registry is used to validate whether a bootstrap request should be accepted and
to configure UI behaviors such as operation channel mapping and display labels.
For PayNote Delivery, the UI label should use the type name without the `PayNote/`
prefix (for example, `PayNote Delivery`).

Request inputs are dynamic. Simple scalar types map to standard inputs, while
objects/lists/dictionaries require nested editing. When the request (or a nested
field) is a generic Blue node with no resolvable type, the UI should fall back to
an open JSON/literal editor. Example:

```yaml
document:
  description: Some blue document
```

If an operation does not declare a request at all, the UI should not show a
form; it becomes a no-input operation. Regardless of whether a form is shown,
invocation must go through an explicit confirmation step.

The design must remain extensible for upcoming requirements like type-specific
renderers (for example, `Common/Timestamp` as a date picker) or field policies
(e.g. auto-fill `acceptedAt` at invocation time).

## Stakeholders & Personas

- Bank client (customer) - runs operations relevant to their PayNote or PayNote
  Delivery.
- Bank operator - needs a consistent interface to debug or verify operations
  across documents.
- Integration developer - relies on contract-driven UI behavior without manual
  changes per document type.

## Scope / Use-Case Scenarios

1. A user views a PayNote Delivery and sees only delivery operations scoped to
   the root delivery document and filtered by `payNoteReceiver` channel.
2. A user views a PayNote and sees PayNote operations filtered by
   `payeeChannel`.
3. A request with `Text`, `Integer`, `Double`, or `Boolean` fields renders
   standard inputs with validation.
4. A request containing objects, lists, or dictionaries opens nested editors
   (breadcrumb navigation) for complex inputs.
5. A request (or nested field) that is a generic Blue node or cannot be resolved
   renders a raw JSON/literal editor.
6. An operation with no request renders no form; the user proceeds directly to
   confirmation.
7. Operations missing a `channel` are hidden from the available actions list.
8. Every operation invocation is preceded by a confirmation step that shows the
   payload summary.

## Constraints & Assumptions

- Only root document contracts are surfaced for the current view; nested scopes
  are out of scope for the first iteration.
- Channel key filtering is configurable; identity matching is deferred until the
  bank client has a distinct MyOS identity.
- Supported contract types are explicit and drive both bootstrap validation and
  UI configuration (labels and channel mapping).
- Blue parsing/validation uses the Blue runtime and repository contracts to
  preserve type fidelity.
- Future field policies (auto-fill/skip fields) and type-specific renderers are
  expected but are not required in the first implementation.
