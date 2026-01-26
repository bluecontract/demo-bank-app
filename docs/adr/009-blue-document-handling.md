# 009. Blue Document Handling for PayNote Delivery

## Status

- 2026-01-14 Proposed

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

## Decision

We will handle PayNote Delivery and PayNote payloads with the Blue language
library. Incoming payloads are deserialized into Blue nodes, validated with
`isTypeOf` against the repository schemas, converted to typed output with
`nodeToSchemaOutput` when needed, and serialized back with `nodeToJson` after
modifications.

## Consequences

- Consistent schema validation and safer document manipulation.
- Stable serialization path for storage and outbound operations.

* Requires careful handling of parse failures and schema mismatches.

## Alternatives Considered

1. **Raw JSON handling**

   - Pros: minimal dependencies, simple.
   - Cons: fragile type checks, higher risk of schema drift.

2. **Manual typed DTOs only**
   - Pros: explicit typings in app code.
   - Cons: duplicated schema logic and no canonical Blue serialization.
