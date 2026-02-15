# 009. Blue Document Handling for PayNote Delivery

## Status

- 2026-01-14 Accepted

## Context

PayNote Delivery webhooks and operations exchange Blue documents (PayNote
Delivery, PayNote, and related event payloads). The bank needs to validate
document types, inspect nested fields (channel participants, card transaction
details), and update the documents before invoking MyOS operations or storing
records. Handling these payloads as untyped JSON risks schema drift and
inconsistent serialization.

### Constraints

- We must preserve document fidelity when reading, validating, and writing.
- Type checks must align with Blue repository schemas.
- The bank already uses the Blue language library in PayNote webhook handling.
- `nodeToSchemaOutput` drops fields that are not defined in the target schema.
- `nodeToJson(..., 'simple')` is lossy and can strip `type` metadata needed for
  MyOS resolution/initialization.

## Decision

We use one explicit model for Blue payload handling:

1. Parse incoming payload to `BlueNode`.
2. Resolve runtime view with `blue.resolve(node)` for business logic.
3. Validate type only with `blue.isTypeOf(..., schema, { checkSchemaExtensions: true })`.
4. Read contracts/channels from resolved node (`getContracts`, `getProperties`)
   or from a derived resolved-simple snapshot.
5. Serialize according to target:
   - MyOS operations/bootstrap payloads: `original` or `official` (lossless).
   - DB persistence: compact representation (no resolved expansion).
   - UI/logging/diagnostics: `simple` only.

### Representation Rules

- `simple` is not a source of truth for type checks.
- Runtime type checks must not compare `blueId` strings directly; use `isTypeOf`.
- `nodeToSchemaOutput` is for schema-shaped reads only; it may drop unknown
  fields and therefore cannot be the only runtime representation.
- We do not persist fully resolved documents in DynamoDB.
- LLM/summary payloads must stay compact/stripped and must not include resolved
  full-type expansion.

### Allowed Usage by Context

- Runtime decisions (webhooks, bootstrap gating, bindings, routing):
  - parse + resolve + `isTypeOf`
- Outbound to MyOS:
  - `nodeToJson(..., 'original' | 'official')`
  - when required for inline type fidelity, use `restoreInlineTypes`
- Storage:
  - compact JSON only (single stored form)
- Summary/LLM:
  - compact/stripped contract payloads; no resolved expanded document dumps

### Error Policy

- Parse/resolve/type-validation failures are fail-closed in runtime flows.
- Technical failures are reported as technical reject reasons (not business
  declines).

## Implementation Checklist

### Do

- Parse webhook/API payloads to `BlueNode` before business logic.
- Resolve runtime node with `blue.resolve(...)` for routing/bindings/contracts.
- Validate document/event types only via `blue.isTypeOf(...)`.
- Use `nodeToSchemaOutput(...)` only when strict schema-shaped read is intended.
- Persist only compact representation to storage.
- Keep summary/LLM payloads compact/stripped.

### Don't

- Do not treat `nodeToJson(..., 'simple')` as type authority.
- Do not compare runtime document/event type by raw `blueId` string.
- Do not persist fully resolved documents in DynamoDB.
- Do not send resolved full-document expansions to summary/LLM paths.
- Do not add fallback business decisions based on unparsed raw JSON.

## Consequences

- Deterministic runtime behavior for minimized/compact payloads.
- Fewer regressions caused by missing inherited contracts in unresolved JSON.
- Clear contract of which representation is allowed in each path.
- Lower payload and storage pressure by avoiding resolved persistence.
- Requires strict discipline: no ad-hoc raw JSON type checks in runtime code.

## Alternatives Considered

1. **Raw JSON handling**

   - Pros: minimal dependencies, simple.
   - Cons: fragile type checks, higher risk of schema drift.

2. **Manual typed DTOs only**
   - Pros: explicit typings in app code.
   - Cons: duplicated schema logic and no canonical Blue serialization.
