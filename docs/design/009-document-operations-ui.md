# Solution Design - Document Operations UI (Demo Bank)

## Date

2026-01-15

## Context

The demo bank needs a contract-driven operations UI that can surface and invoke
operations defined in Blue document contracts. The UI should be scoped to the
current document (root contracts only), filter operations by a configurable
channel key, and render request inputs dynamically. Unknown or generic Blue node
inputs must degrade to a raw JSON/literal editor. Operations without a request
are treated as no-input operations. Operations without a `channel` are hidden.
Every invocation is gated by a confirmation step.

The bank also maintains a supported-contract registry used across the backend
and UI to validate bootstrap requests, define display labels, and configure
operation channel mapping.

References:

- `docs/problem-exploration/008-document-operations-ui.md`
- `docs/requirements/008-document-operations-ui.md`

## Proposed Architecture

Flow (UI):

1. Parse the current document into a Blue node using `@blue-labs/language` and
   `@blue-repository/types`.
2. Collect root `Conversation/Operation` contracts from the document.
3. Filter operations by the registry-defined channel key; hide operations with
   no channel.
4. When an operation is selected, build a request model from its `request` node.
5. Render either a dynamic form (typed fields) or a raw JSON/literal editor.
6. Always show a confirmation step that summarizes the payload.
7. Invoke `POST /v1/contracts/:sessionId/:operation` with the final payload.

## Component Responsibilities

| Component / Module            | Responsibility                                                             |
| ----------------------------- | -------------------------------------------------------------------------- |
| `useDocumentOperations` hook  | Parse document, collect root operations, filter by channel key/identity.   |
| `OperationList`               | Display available operations and descriptions.                             |
| `OperationFormBuilder`        | Convert request Blue node into a form model or raw JSON editor fallback.   |
| `OperationForm`               | Render the form, handle nested editors, and gather input values.           |
| `OperationConfirmation`       | Present payload summary and confirm submission.                            |
| `runContractOperation` client | Send the operation payload to the bank API.                                |
| `SupportedContractRegistry`   | Map supported contract types to display labels and operation channel keys. |

## Supported Contract Registry

The bank maintains an explicit registry of supported contract types. It is used
by the backend to accept or reject bootstrap requests and by the UI to determine
labels and operation channel filtering.

Example registry entry structure:

```ts
type SupportedContract = {
  typeBlueId: string;
  displayName: string; // use type name without `PayNote/` prefix
  operationsChannelKey: string;
};
```

## Operation Discovery

- Use Blue to parse the document into a `BlueNode`.
- Read only the root `contracts` map. Nested scopes are not traversed.
- Filter contracts by `Conversation/Operation` schema.
- Resolve `channel` to a contract key in the same root scope; if the channel is
  missing, hide the operation.
- Source the channel key and display label from the supported-contract registry
  so the same hook can be reused across PayNote (`payeeChannel`) and PayNote
  Delivery (`payNoteReceiver`).

## Request Modeling and Rendering

### Request Presence

- If `operation.request` is missing, the UI does not render inputs and proceeds
  directly to confirmation with an empty payload.

### Type Mapping

- Resolve the request node with Blue (using `resolve` and shallow limits) to
  obtain a stable shape.
- Map Blue types to field editors:
  - `Text` -> text input
  - `Integer` -> integer input
  - `Double` -> numeric input
  - `Boolean` -> toggle/checkbox
  - `List` -> list editor with add/remove and per-item rendering
  - `Dictionary` -> key/value editor with unique keys
  - Object with `properties` -> nested form or drill-down editor

### Raw JSON/Literal Fallback

- If a node has no resolvable type (generic Blue node) or resolution fails, the
  editor falls back to a raw JSON/literal input.
- This applies both at the root request level and for nested fields, such as:

```yaml
document:
  description: Some blue document
```

### Nested Editing

- For complex objects, lists, or dictionaries, open a nested editor in the same
  modal with breadcrumb navigation and a back action.

## Validation and Serialization

- Convert form values into a JSON payload and validate with Blue where possible
  (build a node and run `isTypeOfNode`).
- For raw JSON/literal fields, accept any JSON value (string/number/boolean/null
  or object/array). If parsing fails, block submission and surface an error.

## Confirmation Step

- Confirmation is always required, even for no-input operations.
- The confirmation view displays the operation name, description, and a JSON
  preview of the payload.

## Extensibility (Future)

- Introduce a `TypeRendererRegistry` keyed by BlueId to override rendering
  (for example, `Common/Timestamp` -> date picker).
- Add `FieldPolicy` hooks for auto-fill/skip rules (for example, populate
  `acceptedAt` with invocation time).
- Add field-level exclusions or defaults without changing the core form builder.

## Out of Scope

- Nested scope operation discovery beyond the root document.
- Specialized renderers or auto-filled fields (documented for future extension).
