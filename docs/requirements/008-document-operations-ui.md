# Requirements Specification - Document Operations UI (Demo Bank)

## Date

2026-01-15

## Functional Requirements

| ID        | Requirement                                                                                                                                                                                                                                   | Priority |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-OPS-1  | The UI discovers `Conversation/Operation` contracts from the root `contracts` of the document currently in view and does not traverse nested scopes.                                                                                          | Must     |
| FR-OPS-2  | Operation visibility is filtered by a configurable channel key (e.g. `payeeChannel` for PayNote, `payNoteReceiver` for PayNote Delivery).                                                                                                     | Must     |
| FR-OPS-3  | The operation list displays the contract name and description when available.                                                                                                                                                                 | Must     |
| FR-OPS-4  | If an operation has no `request` definition, the UI shows no input form and treats it as a no-input operation.                                                                                                                                | Must     |
| FR-OPS-5  | When a `request` is present, the UI builds inputs for `Text`, `Integer`, `Double`, `Boolean`, objects, lists, and dictionaries, including basic validation and required-field checks.                                                         | Must     |
| FR-OPS-6  | Complex fields (object/list/dictionary entries) can be edited via nested sub-forms with breadcrumb navigation.                                                                                                                                | Must     |
| FR-OPS-7  | If a request or nested field is a generic Blue node (no resolvable type) or the type cannot be resolved, the UI provides a raw JSON/literal editor for that field or the entire request (e.g. `document: { description: ... }`).              | Must     |
| FR-OPS-8  | Every operation invocation includes an explicit confirmation step that displays the payload summary and requires user confirmation before calling the API.                                                                                    | Must     |
| FR-OPS-9  | Invocations use `POST /v1/contracts/:sessionId/:operation` and send the payload built from the form, raw JSON editor, or an empty object when no inputs exist.                                                                                | Must     |
| FR-OPS-10 | Operations without a `channel` are hidden from the available actions list.                                                                                                                                                                    | Must     |
| FR-OPS-11 | The bank maintains an explicit supported-contract registry that defines per-type display labels (using the type name without the `PayNote/` prefix) and the channel key used for operation filtering.                                         | Must     |
| FR-OPS-12 | The implementation exposes extension points for type renderers and field policies (for example, `Common/Timestamp` as a date picker, or auto-fill `acceptedAt` with invocation time) without changing the core operation list/component APIs. | Should   |

## Non-Functional Requirements

| ID        | Category        | Requirement                                                                                                 | Metric/Target                 |
| --------- | --------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------- |
| NFR-OPS-1 | Compatibility   | Blue parsing and validation use `@blue-labs/language` with `@blue-repository/types` to avoid schema drift.  | No type mismatches            |
| NFR-OPS-2 | Resilience      | Unknown or unresolved request types degrade gracefully to raw JSON/literal editing without breaking the UI. | 0 fatal errors on unknowns    |
| NFR-OPS-3 | UX Safety       | Confirmation is required for every invocation to reduce accidental operations.                              | 100% of invocations confirmed |
| NFR-OPS-4 | Maintainability | The UI reuses existing shared components and avoids new form libraries unless strictly required.            | Minimal new dependencies      |
| NFR-OPS-5 | Fidelity        | Payloads preserve Blue semantics (numbers vs strings, boolean values) when serialized and sent to the API.  | 0 payload type regressions    |

## Acceptance Criteria

- The operations list is derived from root document contracts and filtered by the configured channel key.
- Operations without a `request` render no inputs but still require confirmation before invocation.
- Operations missing a `channel` are not shown.
- Operations with a request render dynamic inputs for core types and nested editors for complex types.
- Generic or unresolved Blue nodes fall back to a raw JSON/literal editor.
- All operations invoke `POST /v1/contracts/:sessionId/:operation` with the expected payload and a confirmation step.
- The design documents identify extension points for type-specific renderers and auto-filled fields.
